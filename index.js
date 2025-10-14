const { runLogin } = require('./models/autologin');
const { runFarming } = require('./models/autofarm');
const { logger, colors, askQuestion } = require('./utils/utils');

async function showMenu() {
    console.clear();
    console.log(`${colors.bold}${colors.blue}===================================${colors.reset}`);
    console.log(`${colors.bold}${colors.bgBlue}==      DAWN AUTOMATION V2       ==${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}===================================${colors.reset}\n`);
    console.log(`${colors.bold}${colors.bgBlue}==          Powered By           ==${colors.reset}`);
    console.log(`${colors.bold}${colors.bgBlue}==      DOCOSA JAGOCUAN GROUP    ==${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}===================================${colors.reset}\n`);
    console.log(`${colors.bold}${colors.bgBlue}==  https://github.com/cmalf     ==${colors.reset}`);
    console.log(`${colors.bold}${colors.bgBlue}==  https://github.com/jagocuan  ==${colors.reset}`);
    console.log(`${colors.bold}${colors.bgBlue}==  Coder: Panca                 ==${colors.reset}`);
    console.log(`${colors.bold}${colors.blue}===================================${colors.reset}\n`);
    console.log(` ${colors.yellow}1.${colors.reset} Auto Login (Get Session Tokens)`);
    console.log(` ${colors.yellow}2.${colors.reset} Auto Farm Points`);
    console.log(` ${colors.yellow}3.${colors.reset} Exit\n`);

    const choice = await askQuestion(logger.input('Please select an option: '));
    return choice.trim();
}

async function main() {
    while (true) {
        const choice = await showMenu();
        switch (choice) {
            case '1':
                await runLogin();
                await askQuestion(`\n${logger.input('Press Enter to return to the menu...')}`);
                break;
            case '2':
                await runFarming(); // This is a continuous loop, so it won't return
                break;
            case '3':
                logger.info('Exiting script. Goodbye!');
                process.exit(0);
            default:
                logger.error('Invalid option. Please try again.');
                await new Promise(res => setTimeout(res, 1500));
                break;
        }
    }
}

main().catch(err => {
    logger.error(`[FATAL] An unhandled error occurred in the main process:`, err);
});