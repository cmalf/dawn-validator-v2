const fs = require('fs');
const path = require('path');

class CountdownTracker {
    constructor() {
        this.countdowns = {};
        this.initializeFileSystem();
    }

    initializeFileSystem() {
        try {
            // Get the application root directory
            const rootDir = process.cwd();
            
            // Define paths using path.join for cross-platform compatibility
            this.supportDir = path.join(rootDir, 'SUPPORT');
            this.countdownsDir = path.join(this.supportDir, 'COUNTDOWNS');
            this.countdownsFile = path.join(this.countdownsDir, 'countdowns.json');

            // Create directories if they don't exist
            this.createDirectoryStructure();

            // Initialize or load the countdowns file
            this.loadOrCreateCountdownsFile();
        } catch (error) {
            console.error('Error initializing file system:', error);
            throw new Error('Failed to initialize countdown tracker');
        }
    }

    createDirectoryStructure() {
        const directories = [this.supportDir, this.countdownsDir];
        
        directories.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
            }
        });
    }

    loadOrCreateCountdownsFile() {
        try {
            if (fs.existsSync(this.countdownsFile)) {
                const data = fs.readFileSync(this.countdownsFile, 'utf8');
                this.countdowns = JSON.parse(data);
            } else {
                this.countdowns = {};
                this.saveCountdowns();
            }
        } catch (error) {
            this.countdowns = {};
            this.saveCountdowns();
        }
    }

    saveCountdowns() {
        try {
            fs.writeFileSync(this.countdownsFile, JSON.stringify(this.countdowns, null, 2), {
                encoding: 'utf8',
                mode: 0o644
            });
        } catch (error) {
            console.error('Error saving countdowns:', error);
        }
    }

    startCountdown(email, cycleTime) {
        const now = Date.now();
        this.countdowns[email] = {
            startTime: now,
            endTime: now + (cycleTime * 1000),
            cycleTime: cycleTime
        };
        this.saveCountdowns();
    }

    getTimeRemaining(email) {
        const countdown = this.countdowns[email];
        if (!countdown) return 0;

        const now = Date.now();
        const timeLeft = Math.max(0, countdown.endTime - now);

        if (timeLeft === 0) {
            countdown.startTime = now;
            countdown.endTime = now + (countdown.cycleTime * 1000);
            this.saveCountdowns();
        }

        return Math.ceil(timeLeft / 1000);
    }

    formatTimeRemaining(email) {
        const seconds = this.getTimeRemaining(email);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    clearCountdown(email) {
        if (this.countdowns[email]) {
            delete this.countdowns[email];
            this.saveCountdowns();
        }
    }

    getAllCountdowns() {
        return { ...this.countdowns };
    }

    cleanupExpiredCountdowns() {
        const now = Date.now();
        let changed = false;

        Object.entries(this.countdowns).forEach(([email, countdown]) => {
            if (countdown.endTime < now - (24 * 60 * 60 * 1000)) {
                delete this.countdowns[email];
                changed = true;
            }
        });

        if (changed) {
            this.saveCountdowns();
        }
    }
}

module.exports = new CountdownTracker();

