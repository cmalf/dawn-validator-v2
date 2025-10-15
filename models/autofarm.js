const fs = require('fs/promises');
const yaml = require('js-yaml');
const axios = require('axios');
const randomUserAgent = require('random-user-agent');
const countdownTracker = require('../utils/countdowns');
const {
    logger,
    colors,
    getProxyAgent,
    sleep,
    readFileLines,
    isProxyError,
    getBackupProxy,
    updateProxiesFile
} = require('../utils/utils');

const ACCOUNTS_FILE = 'config/accounts_session.yaml';
const PROXY_FILE = 'config/proxies.txt';
const CYCLE_TIME_SECONDS = 10 * 60; // 10 minutes
const MAX_RETRIES_429 = 3; // IMPROVEMENT: Define max retries for 429 error
const RETRY_DELAY_SECONDS = 5; // IMPROVEMENT: Define delay between retries

async function processAccount(account, proxy) {
    console.log(`\n${colors.blue}========================================${colors.reset}`);
    logger.info(`Processing account: ${colors.cyan}${account.email}${colors.reset}`);

    const proxyAgent = getProxyAgent(proxy);
    const axiosInstance = axios.create({ httpsAgent: proxyAgent, httpAgent: proxyAgent, timeout: 20000 });

    let proxyDisplayInfo = 'None';
    if (proxy) {
        try {
            const ipResponse = await axiosInstance.get('https://ipinfo.io/json');
            proxyDisplayInfo = ipResponse.data.ip;
        } catch (ipError) {
            logger.warn(`Failed to get public IP for proxy. Using proxy URL.`);
            proxyDisplayInfo = proxy;
            if (isProxyError(ipError)) throw ipError; // Re-throw proxy errors to be handled by failover
        }
    }
    logger.info(`Using Proxy / IP: ${proxy ? colors.cyan + proxyDisplayInfo : 'None'}${colors.reset}`);

    axiosInstance.defaults.headers.common = {
        'Host': 'api.dawninternet.com', 'User-Agent': randomUserAgent("desktop", "chrome", "linux"), 'Content-Type': 'application/json', 'Authorization': `Bearer ${account.session_token.trim()}`, 'Accept': '*/*', 'Origin': 'chrome-extension://fpdkjdnhkakefebpekbdhillbhonfjjp', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', 'Accept-Language': 'en-US,en;q=0.9',
    };

    // --- 1. Fetch User Info ---
    logger.info(`[TASK] Fetching user info...`);
    const infoUrl = `https://api.dawninternet.com/point?user_id=${account.user_id}`;
    const infoResponse = await axiosInstance.get(infoUrl);
    const { points, referral_points } = infoResponse.data;
    logger.success(`Points: ${colors.yellow}${points}${colors.reset}, Referral Points: ${colors.yellow}${referral_points}${colors.reset}`);
    await sleep(2000);

    // --- 2. Send Ping (with Retry Logic for 429 error) ---
    logger.info(`[TASK] Sending ping...`);
    const pingUrl = 'https://api.dawninternet.com/ping?role=extension';
    const payload = { user_id: account.user_id, extension_id: "fpdkjdnhkakefebpekbdhillbhonfjjp", timestamp: new Date().toISOString() };

    // IMPROVEMENT: Retry loop for 429 errors
    for (let attempt = 1; attempt <= MAX_RETRIES_429; attempt++) {
        try {
            const pingResponse = await axiosInstance.post(pingUrl, payload);
            if (pingResponse.status >= 200 && pingResponse.status < 300) {
                logger.success(`Ping successful: ${pingResponse.data.message}`);
                console.log(`${colors.blue}========================================${colors.reset}`);
                return; // Exit the function on success
            } else {
                logger.error(`Ping failed with status: ${pingResponse.status}`);
            }
        } catch (error) {
            // Check if it's a 429 error
            if (error.response && error.response.status === 429) {
                logger.warn(`Received 429 Too Many Requests. Attempt ${attempt}/${MAX_RETRIES_429}. Retrying in ${RETRY_DELAY_SECONDS}s...`);
                if (attempt < MAX_RETRIES_429) {
                    await sleep(RETRY_DELAY_SECONDS * 1000);
                    continue; // Continue to the next iteration of the loop
                }
            }
            // For any other error, or if max retries are exhausted, throw it to be handled by the main loop
            throw error;
        }
    }
    // This line is reached if all retries for 429 fail
    throw new Error(`Ping failed for ${account.email} after ${MAX_RETRIES_429} attempts due to 429 errors.`);
}

async function runFarming() {
    console.log(`\n${colors.bold}${colors.bgBlue}--- Starting Auto Farm Script ---${colors.reset}`);
    let accounts = [];
    try {
        const fileContents = await fs.readFile(ACCOUNTS_FILE, 'utf8');
        accounts = yaml.load(fileContents).accounts || [];
        if (accounts.length === 0) {
            logger.error(`[FATAL] No accounts found in ${ACCOUNTS_FILE}. Stopping.`);
            return;
        }
        logger.info(`[SYSTEM] Loaded ${accounts.length} accounts.`);
    } catch (e) {
        logger.error(`[FATAL] Failed to read or parse ${ACCOUNTS_FILE}: ${e.message}`);
        return;
    }

    let proxies = await readFileLines(PROXY_FILE);
    if (proxies.length > 0 && accounts.length > proxies.length) {
        logger.error(`[FATAL] Accounts (${accounts.length}) > Proxies (${proxies.length}). Stopping.`);
        return;
    }

    logger.info(`[SYSTEM] Each account will run on its own ${CYCLE_TIME_SECONDS / 60}-minute cycle.`);

    while (true) {
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            const timeRemaining = countdownTracker.getTimeRemaining(account.email);

            if (account.isSuspended) {
                continue;
            }

            if (timeRemaining > 0) {
                process.stdout.write(`\r${colors.yellow}[SKIP]${colors.reset} Account ${colors.cyan}${account.email}${colors.reset} is on cooldown. Time left: ${countdownTracker.formatTimeRemaining(account.email)}      `);
                continue;
            }

            process.stdout.write(`\r                                                                                                   \r`);

            let success = false;
            let attempt = 0;
            while (!success && attempt < 2) {
                const proxy = proxies.length > 0 ? proxies[i] : null;
                attempt++;
                try {
                    await processAccount(account, proxy);
                    // FIX: Countdown is now ONLY started on SUCCESS
                    countdownTracker.startCountdown(account.email, CYCLE_TIME_SECONDS);
                    logger.success(`Account ${account.email} finished. Cooldown for 10 minutes started.`);
                    success = true;

                } catch (error) {
                    if (attempt < 2 && proxy && isProxyError(error)) {
                        logger.warn(`Proxy ${proxy} failed for ${account.email}. Replacing from backup.`);
                        const newProxy = await getBackupProxy();
                        if (newProxy) {
                            proxies[i] = newProxy;
                            await updateProxiesFile(proxies);
                            logger.info(`Replaced with new proxy: ${newProxy}. Retrying task immediately...`);
                        } else {
                            logger.error(`No backup proxies available. Task failed for this cycle.`);
                            break;
                        }
                    } else {
                        if (error.response) logger.error(`Request failed for ${account.email} with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
                        else logger.error(`Task failed for ${account.email}: ${error.message}`);
                        // FIX: REMOVED countdownTracker.startCountdown from the failure block.
                        // Now it will just try again on the next main loop check.
                        break;
                    }
                }
            }
        }
        await sleep(1000); // Check timers every second
    }
}

module.exports = { runFarming };
