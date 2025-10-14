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
            if (isProxyError(ipError)) throw ipError; // Re-throw proxy errors
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

    // --- 2. Send Ping ---
    logger.info(`[TASK] Sending ping...`);
    const pingUrl = 'https://api.dawninternet.com/ping?role=extension';
    const payload = { user_id: account.user_id, extension_id: "fpdkjdnhkakefebpekbdhillbhonfjjp", timestamp: new Date().toISOString() };
    const pingResponse = await axiosInstance.post(pingUrl, payload);
    if (pingResponse.status >= 200 && pingResponse.status < 300) {
        logger.success(`Ping successful: ${pingResponse.data.message}`);
    } else {
        logger.error(`Ping failed. Status: ${pingResponse.status}`);
    }
    console.log(`${colors.blue}========================================${colors.reset}`);
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
                // This check is inside the loop in case we want to manually edit the file
                continue; 
            }

            if (timeRemaining > 0) {
                process.stdout.write(`\r${colors.yellow}[SKIP]${colors.reset} Account ${colors.cyan}${account.email}${colors.reset} is on cooldown. Time left: ${countdownTracker.formatTimeRemaining(account.email)}      `);
                continue;
            }
            
            process.stdout.write(`\r                                                                                                   \r`); // Clear line

            let success = false;
            let attempt = 0;
            while (!success && attempt < 2) { // 1 main try, 1 retry with backup
                const proxy = proxies.length > 0 ? proxies[i] : null;
                attempt++;
                try {
                    await processAccount(account, proxy);
                    countdownTracker.startCountdown(account.email, CYCLE_TIME_SECONDS);
                    logger.success(`Account ${account.email} finished. Cooldown started.`);
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
                        logger.error(`Task failed for ${account.email}: ${error.message}`);
                        logger.warn(`Starting cooldown for ${account.email} anyway to prevent spam.`);
                        countdownTracker.startCountdown(account.email, CYCLE_TIME_SECONDS);
                        break;
                    }
                }
            }
        }
        await sleep(1000); // Check timers every second
    }
}

module.exports = { runFarming };