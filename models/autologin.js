const fs = require('fs/promises');
const yaml = require('js-yaml');
const axios = require('axios');
const crypto = require('crypto');
const randomUserAgent = require('random-user-agent');
const {
    logger,
    colors,
    readFileLines,
    askQuestion,
    sleep,
    isProxyError,
    getBackupProxy,
    updateProxiesFile,
    getProxyAgent
} = require('../utils/utils');

const EMAIL_FILE = 'config/email_data.txt';
const PROXY_FILE = 'config/proxies.txt';
const OUTPUT_YAML_FILE = 'config/accounts_session.yaml';
const MIN_DELAY_SECONDS = 5;
const MAX_DELAY_SECONDS = 10;

/**
 * Generates a unique Privy Client ID (PCI). This is just alternative  for uuid4 module
 */
function PCI() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.randomBytes(1)[0] & (15 >> (c / 4))).toString(16)
    );
}

/**
 * Saves account data to the YAML file.
 */
async function saveAccountToYaml(accountData) {
    try {
        let existingData = { accounts: [] };
        try {
            const fileContent = await fs.readFile(OUTPUT_YAML_FILE, 'utf8');
            const parsedYaml = yaml.load(fileContent);
            if (parsedYaml && Array.isArray(parsedYaml.accounts)) {
                existingData = parsedYaml;
            }
        } catch (error) { /* File doesn't exist, will be created */ }

        // Avoid adding duplicate emails
        const accountIndex = existingData.accounts.findIndex(acc => acc.email === accountData.email);
        if (accountIndex > -1) {
            existingData.accounts[accountIndex] = accountData; // Update existing
        } else {
            existingData.accounts.push(accountData); // Add new
        }

        const yamlString = yaml.dump(existingData, { indent: 2 });
        await fs.writeFile(OUTPUT_YAML_FILE, yamlString, 'utf8');
        logger.success(`Data for ${colors.blue}${accountData.email}${colors.reset} saved to ${OUTPUT_YAML_FILE}`);
    } catch (error) {
        logger.error(`Failed to save data to YAML file: ${error.message}`);
    }
}

/**
 * Core logic for processing a single account's login.
 */
async function processLoginForAccount(email, proxy) {
    const proxyAgent = getProxyAgent(proxy);
    const axiosInstance = axios.create({ httpsAgent: proxyAgent, httpAgent: proxyAgent, timeout: 30000 });

    let publicIp = 'Unknown';
    try {
        const ipResponse = await axiosInstance.get('https://ipinfo.io/json');
        publicIp = ipResponse.data.ip;
    } catch (ipError) {
        logger.warn(`Failed to get public IP for the proxy. Continuing...`);
        if (isProxyError(ipError)) throw ipError; // Re-throw proxy errors to trigger failover
    }

    logger.info(`Processing account: ${colors.blue}${email}${colors.reset} with proxy IP: ${colors.yellow}${publicIp}${colors.reset}`);

    const userAgent = randomUserAgent("desktop", "chrome", "linux");
    const privyCaId = PCI();

    // Step 1: Initialize
    logger.info('Step 1: Sending authentication code request...');
    const initHeaders = { 'Host': 'auth.privy.io', 'privy-client': 'react-auth:2.24.0', 'privy-app-id': 'cmfb724md0057la0bs4tg0vf1', 'User-Agent': userAgent, 'accept': 'application/json', 'content-type': 'application/json', 'privy-ca-id': privyCaId, 'Origin': 'chrome-extension://fpdkjdnhkakefebpekbdhillbhonfjjp' };
    const initResponse = await axiosInstance.post('https://auth.privy.io/api/v1/passwordless/init', { email }, { headers: initHeaders });
    if (!initResponse.data.success) throw new Error('Login initialization failed.');
    logger.success('Code request sent. Please check your email.');

    // Step 2: Get Code
    const authCode = await askQuestion(logger.input('Enter the 6-digit authentication code: '));

    // Step 3: Authenticate
    logger.info('Step 2: Authenticating with code...');
    const authResponse = await axiosInstance.post('https://auth.privy.io/api/v1/passwordless/authenticate', { email, code: authCode, mode: 'login-or-sign-up' }, { headers: initHeaders });
    const privyToken = authResponse.data.token;
    if (!privyToken) throw new Error('Failed to get privy token.');
    logger.success('Authentication successful.');

    // Step 4: Fetch Session Token
    logger.info('Step 3: Fetching session token...');
    const sessionHeaders = { 'Host': 'api.dawninternet.com', 'x-privy-token': privyToken, 'User-Agent': userAgent, 'Accept': 'application/json, text/plain, */*', 'Origin': 'chrome-extension://fpdkjdnhkakefebpekbdhillbhonfjjp' };
    const sessionResponse = await axiosInstance.get('https://api.dawninternet.com/auth?jwt=true&role=extension', { headers: sessionHeaders });
    const { user, session_token } = sessionResponse.data;

    const accountInfo = { email, user_id: user.id, isSuspended: user.isSuspended, session_token };
    logger.success('Successfully fetched session token!');

    // Step 5: Save
    await saveAccountToYaml(accountInfo);
}

/**
 * Main function to run the login script.
 */
async function runLogin() {
    console.log(`\n${colors.bold}${colors.bgBlue}--- Starting Auto Login Script ---${colors.reset}`);
    const emails = await readFileLines(EMAIL_FILE);
    let proxies = await readFileLines(PROXY_FILE);

    if (emails.length === 0) {
        logger.warn(`File ${EMAIL_FILE} is empty. No accounts to process.`);
        return;
    }
    if (emails.length > proxies.length) {
        logger.error(`The number of emails (${emails.length}) is greater than the number of proxies (${proxies.length}). Please add more proxies.`);
        return;
    }

    for (let i = 0; i < emails.length; i++) {
        let success = false;
        let attempt = 0;
        console.log(`\n${colors.cyan}----------------------------------------${colors.reset}`);

        while (!success && attempt < 2) { // Allow one main proxy + one backup proxy
            const email = emails[i];
            const proxy = proxies[i];
            attempt++;

            try {
                await processLoginForAccount(email, proxy);
                success = true;
            } catch (error) {
                if (attempt < 2 && isProxyError(error)) {
                    logger.warn(`Proxy ${proxy} failed for ${email}. Attempting to replace from backup.`);
                    const newProxy = await getBackupProxy();
                    if (newProxy) {
                        proxies[i] = newProxy;
                        await updateProxiesFile(proxies);
                        logger.info(`Replaced with new proxy: ${newProxy}. Retrying...`);
                    } else {
                        logger.error(`No backup proxies available. Skipping account.`);
                        break; // Break while loop
                    }
                } else {
                    if (error.response) logger.error(`Request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
                    else logger.error(`An error occurred for ${email}: ${error.message}`);
                    break; // Break while loop
                }
            }
        }

        if (i < emails.length - 1) {
            const delay = Math.floor(Math.random() * (MAX_DELAY_SECONDS - MIN_DELAY_SECONDS + 1) + MIN_DELAY_SECONDS);
            logger.info(`Waiting for ${delay} seconds before the next account...`);
            await sleep(delay * 1000);
        }
    }
    console.log(`\n${colors.bold}${colors.bgBlue}--- All Accounts Processed ---${colors.reset}`);
}

module.exports = { runLogin };