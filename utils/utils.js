const fs = require('fs/promises');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PROXIES_FILE = 'config/proxies.txt';
const BACKUP_PROXIES_FILE = 'config/proxies_backup.txt';

// --- ANSI Color Codes ---
const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    blue: "\x1b[34m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    bgBlue: "\x1b[44m",
};

// --- Colored Logger ---
const logger = {
    info: (message) => console.log(`${colors.green}[INFO]${colors.reset} ${message}`),
    success: (message) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`),
    warn: (message) => console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`),
    error: (message) => console.log(`${colors.red}[ERROR]${colors.reset} ${message}`),
    input: (message) => `${colors.yellow}[INPUT]${colors.reset} ${message}`,
};

/**
 * Creates a proxy agent from a proxy URL.
 * @param {string} proxyUrl - The proxy URL (e.g., http://... or socks5://...).
 * @returns {HttpsProxyAgent|SocksProxyAgent|null} The proxy agent or null if the url is invalid.
 */
function getProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    if (proxyUrl.startsWith('socks')) {
        return new SocksProxyAgent(proxyUrl);
    }
    if (proxyUrl.startsWith('http')) {
        return new HttpsProxyAgent(proxyUrl);
    }
    logger.warn(`Invalid proxy format for: ${proxyUrl}. Supported formats are http:// and socks://`);
    return null;
}

/**
 * Pauses execution for a specified duration.
 * @param {number} ms - The number of milliseconds to sleep.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Reads a file and returns its lines as an array.
 * @param {string} filePath - Path to the file.
 * @returns {Promise<string[]>} An array of lines.
 */
async function readFileLines(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return data.split(/\r?\n/).filter(line => line.trim() !== '');
    } catch (error) {
        if (error.code !== 'ENOENT') { // Don't log error if file just doesn't exist
            logger.error(`Failed to read file ${filePath}: ${error.message}`);
        }
        return [];
    }
}

/**
 * Prompts the user for input in the console.
 * @param {string} query - The question to display.
 * @returns {Promise<string>} The user's input.
 */
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

/**
 * Checks if a given error is likely due to a proxy failure.
 * @param {Error} error - The error object.
 * @returns {boolean} True if it's a proxy-related error.
 */
function isProxyError(error) {
    const proxyErrorCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'];
    if (error.code && proxyErrorCodes.includes(error.code)) {
        return true;
    }
    if (error.message && error.message.includes('timeout')) {
        return true;
    }
    return false;
}

/**
 * BARU: Fungsi untuk menulis ulang file proxy backup.
 * Overwrites the backup proxies file with an updated list.
 * @param {string[]} proxies - The array of proxy strings to save.
 */
async function updateBackupProxiesFile(proxies) {
    try {
        const fileContent = proxies.join('\n');
        await fs.writeFile(BACKUP_PROXIES_FILE, fileContent, 'utf8');
    } catch (error) {
        logger.error(`Failed to write to '${BACKUP_PROXIES_FILE}': ${error.message}`);
    }
}


/**
 * DIUBAH: Mengambil satu proxy dari file backup, dan menghapusnya dari file tersebut.
 * Fetches a single proxy from the backup file and removes it from the file.
 * @returns {Promise<string|null>} A backup proxy URL or null if none are available.
 */
async function getBackupProxy() {
    try {
        const backupProxies = await readFileLines(BACKUP_PROXIES_FILE);
        if (backupProxies.length > 0) {
            const proxyToUse = backupProxies.shift(); // Ambil proxy pertama dari daftar
            await updateBackupProxiesFile(backupProxies); // Simpan sisa proxy ke file backup
            logger.info(`Moved proxy ${proxyToUse} from backup to main list.`);
            return proxyToUse;
        }
        logger.warn(`Backup proxy file '${BACKUP_PROXIES_FILE}' is empty or not found.`);
        return null;
    } catch (e) {
        logger.error(`Could not read backup proxies: ${e.message}`);
        return null;
    }
}

/**
 * Overwrites the main proxies file with an updated list.
 * @param {string[]} proxies - The array of proxy strings to save.
 */
async function updateProxiesFile(proxies) {
    try {
        const fileContent = proxies.join('\n');
        await fs.writeFile(PROXIES_FILE, fileContent, 'utf8');
        logger.info(`Successfully updated '${PROXIES_FILE}'.`);
    } catch (error) {
        logger.error(`Failed to write to '${PROXIES_FILE}': ${error.message}`);
    }
}

module.exports = {
    colors,
    logger,
    getProxyAgent,
    sleep,
    readFileLines,
    askQuestion,
    isProxyError,
    getBackupProxy,
    updateProxiesFile
};
