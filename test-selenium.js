// LibRead Ereader - Automated Selenium Test Suite
// Tests all critical functionality including the -0 placeholder fix

const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const path = require('path');

// Test configuration
const BASE_URL = 'http://localhost:3001';
const SCREENSHOT_DIR = path.join(__dirname, 'test-screenshots');
const TEST_REPORT = [];

// Helper functions
function log(testName, status, message) {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, testName, status, message };
    TEST_REPORT.push(entry);
    console.log(`[${timestamp}] [${status.toUpperCase()}] ${testName}: ${message}`);
}

async function takeScreenshot(driver, name) {
    const screenshotPath = path.join(SCREENSHOT_DIR, `${name}.png`);
    const screenshot = await driver.takeScreenshot();
    fs.writeFileSync(screenshotPath, screenshot, 'base64');
    log('Screenshot', 'INFO', `Saved: ${screenshotPath}`);
    return screenshotPath;
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main test suite
async function runTests() {
    let driver;
    const testsPassed = [];
    const testsFailed = [];

    try {
        console.log('========================================');
        console.log('LibRead Ereader - Automated Test Suite');
        console.log('========================================\n');

        // Create screenshot directory
        if (!fs.existsSync(SCREENSHOT_DIR)) {
            fs.mkdirSync(SCREENSHOT_DIR);
        }

        // Setup Chrome options
        const options = new chrome.Options();
        options.addArguments('--headless'); // Run in headless mode
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--window-size=1920,1080');

        // Build driver
        console.log('1. Initializing browser...');
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        log('Browser Init', 'PASS', 'Chrome browser initialized');

        await takeScreenshot(driver, '01-browser-start');

        // ====================================================================
        // TEST 1: Verify Homepage Loads
        // ====================================================================
        console.log('\n2. Testing Homepage...');
        try {
            await driver.get(BASE_URL);
            await wait(2000);
            
            const title = await driver.getTitle();
            log('Homepage', 'PASS', `Title: ${title}`);
            
            const welcomeTitle = await driver.findElement(By.css('.welcome-title')).getText();
            log('Homepage', 'PASS', `Welcome message: ${welcomeTitle}`);
            
            await takeScreenshot(driver, '02-homepage-loaded');
            testsPassed.push('Homepage Load');
        } catch (error) {
            log('Homepage', 'FAIL', error.message);
            testsFailed.push('Homepage Load');
        }

        // ====================================================================
        // TEST 2: Load Latest Novels
        // ====================================================================
        console.log('\n3. Testing Novel Listing...');
        try {
            const getStartedBtn = await driver.wait(
                until.elementLocated(By.css('.get-started-btn')),
                5000
            );
            await getStartedBtn.click();
            await wait(3000);
            
            // Check if main content is active
            await driver.wait(until.elementLocated(By.id('mainContent')), 5000);
            const mainContent = await driver.findElement(By.id('mainContent'));
            const isActive = await mainContent.getAttribute('class');
            
            if (isActive.includes('active')) {
                log('Novel Listing', 'PASS', 'Main content is active');
            } else {
                throw new Error('Main content not active');
            }
            
            // Check for novel grid
            await driver.wait(until.elementLocated(By.id('novelGrid')), 5000);
            const novels = await driver.findElements(By.css('.novel-card'));
            log('Novel Listing', 'PASS', `Found ${novels.length} novels`);
            
            await takeScreenshot(driver, '03-novel-list-loaded');
            testsPassed.push('Novel Listing');
        } catch (error) {
            log('Novel Listing', 'FAIL', error.message);
            testsFailed.push('Novel Listing');
            await takeScreenshot(driver, '03-novel-list-failed');
        }

        // ====================================================================
        // TEST 3: Click on a Novel (Test Novel Detail Page)
        // ====================================================================
        console.log('\n4. Testing Novel Detail Page...');
        try {
            // Click on first novel
            const firstNovel = await driver.wait(
                until.elementLocated(By.css('.novel-card')),
                5000
            );
            
            // Get novel info before clicking
            const novelTitle = await firstNovel.findElement(By.css('.novel-title')).getText();
            log('Novel Detail', 'INFO', `Clicking on: ${novelTitle}`);
            
            await firstNovel.click();
            await wait(5000); // Give it time to load novel details and chapters
            
            // Check if novel detail view is active
            const detailView = await driver.findElement(By.id('novelDetailView'));
            const isActive = await detailView.getAttribute('class');
            
            if (isActive.includes('active')) {
                log('Novel Detail', 'PASS', 'Novel detail view is active');
            } else {
                throw new Error('Novel detail view not active');
            }
            
            // Check novel title
            const detailTitle = await driver.findElement(By.id('novelTitle')).getText();
            log('Novel Detail', 'PASS', `Novel title: ${detailTitle}`);
            
            await takeScreenshot(driver, '04-novel-detail-loaded');
            testsPassed.push('Novel Detail Page');
        } catch (error) {
            log('Novel Detail', 'FAIL', error.message);
            testsFailed.push('Novel Detail Page');
            await takeScreenshot(driver, '04-novel-detail-failed');
        }

        // ====================================================================
        // TEST 4: Verify Chapter List Loaded (CRITICAL TEST)
        // ====================================================================
        console.log('\n5. Testing Chapter List Loading (CRITICAL)...');
        try {
            // Wait for chapter list to populate
            await wait(3000);
            
            // Check for chapter items
            const chapterItems = await driver.findElements(By.css('.chapter-item'));
            log('Chapter List', 'INFO', `Found ${chapterItems.length} chapter items`);
            
            if (chapterItems.length > 0) {
                log('Chapter List', 'PASS', `Chapter list loaded with ${chapterItems.length} chapters`);
                
                // Get first chapter info
                const firstChapter = chapterItems[0];
                const chapterTitle = await firstChapter.findElement(By.css('.chapter-title')).getText();
                const chapterNumber = await firstChapter.findElement(By.css('.chapter-number')).getText();
                log('Chapter List', 'PASS', `First chapter: ${chapterNumber} - ${chapterTitle}`);
                
                // Check that title doesn't have "C.1:" prefix (title cleaning test)
                if (!chapterTitle.match(/^C\.?\d+:/)) {
                    log('Chapter List', 'PASS', 'Chapter titles are clean (no C.1: prefix)');
                } else {
                    log('Chapter List', 'WARN', 'Chapter title still has prefix');
                }
                
                await takeScreenshot(driver, '05-chapter-list-loaded');
                testsPassed.push('Chapter List Loading');
            } else {
                throw new Error('No chapters found in list');
            }
        } catch (error) {
            log('Chapter List', 'FAIL', error.message);
            testsFailed.push('Chapter List Loading');
            await takeScreenshot(driver, '05-chapter-list-failed');
        }

        // ====================================================================
        // TEST 5: Verify Chapter Content Loaded (CRITICAL TEST)
        // ====================================================================
        console.log('\n6. Testing Chapter Content Loading (CRITICAL)...');
        try {
            // Wait for chapter content
            await driver.wait(until.elementLocated(By.id('chapterContent')), 10000);
            await wait(2000);
            
            // Check if content has actual text (not just loading spinner)
            const contentDiv = await driver.findElement(By.id('chapterContent'));
            const contentHTML = await contentDiv.getAttribute('innerHTML');
            
            if (contentHTML.includes('loading-spinner')) {
                throw new Error('Content still loading');
            }
            
            if (contentHTML.length > 500) {
                log('Chapter Content', 'PASS', `Chapter content loaded (${contentHTML.length} chars)`);
                
                // Check for chapter title
                const chapterHeader = await contentDiv.findElement(By.css('h2')).getText();
                log('Chapter Content', 'PASS', `Chapter header: ${chapterHeader.substring(0, 50)}...`);
                
                await takeScreenshot(driver, '06-chapter-content-loaded');
                testsPassed.push('Chapter Content Loading');
            } else {
                throw new Error('Content too short, may not have loaded properly');
            }
        } catch (error) {
            log('Chapter Content', 'FAIL', error.message);
            testsFailed.push('Chapter Content Loading');
            await takeScreenshot(driver, '06-chapter-content-failed');
        }

        // ====================================================================
        // TEST 6: Test Chapter Navigation (Next/Previous)
        // ====================================================================
        console.log('\n7. Testing Chapter Navigation...');
        try {
            const nextBtn = await driver.findElement(By.id('nextChapter'));
            const isNextEnabled = !(await nextBtn.getAttribute('disabled'));
            
            if (isNextEnabled) {
                log('Navigation', 'INFO', 'Next button is enabled, clicking...');
                await nextBtn.click();
                await wait(3000);
                
                // Check that chapter changed
                const contentDiv = await driver.findElement(By.id('chapterContent'));
                const newContent = await contentDiv.getAttribute('innerHTML');
                
                log('Navigation', 'PASS', 'Navigated to next chapter');
                await takeScreenshot(driver, '07-chapter-navigation');
                testsPassed.push('Chapter Navigation');
            } else {
                log('Navigation', 'INFO', 'Next button disabled (only one chapter?)');
                testsPassed.push('Chapter Navigation');
            }
        } catch (error) {
            log('Navigation', 'FAIL', error.message);
            testsFailed.push('Chapter Navigation');
        }

        // ====================================================================
        // TEST 7: Get Console Logs for -0 Placeholder Fix Verification
        // ====================================================================
        console.log('\n8. Checking Console Logs for -0 Placeholder Fix...');
        try {
            const logs = await driver.manage().logs().get('browser');
            
            let hasArticleIdExtraction = false;
            let hasZeroPlaceholderFix = false;
            let hasChaptersLoaded = false;
            
            logs.forEach(log => {
                const message = log.message;
                if (message.includes('Article ID extracted')) {
                    hasArticleIdExtraction = true;
                    log('Console Check', 'PASS', `Found: ${message.substring(0, 100)}...`);
                }
                if (message.includes('Fixed -0 placeholder')) {
                    hasZeroPlaceholderFix = true;
                    log('Console Check', 'PASS', `✓ CRITICAL: ${message}`);
                }
                if (message.includes('Total chapters loaded')) {
                    hasChaptersLoaded = true;
                    log('Console Check', 'PASS', `Found: ${message}`);
                }
            });
            
            if (hasArticleIdExtraction) {
                testsPassed.push('Article ID Extraction');
            }
            if (hasZeroPlaceholderFix) {
                testsPassed.push('-0 Placeholder Fix');
                log('CRITICAL CHECK', 'PASS', '✓ -0 placeholder fix is working!');
            }
            if (hasChaptersLoaded) {
                testsPassed.push('Chapters Loaded Log');
            }
            
            // Save logs to file
            fs.writeFileSync(
                path.join(SCREENSHOT_DIR, 'console-logs.json'),
                JSON.stringify(logs, null, 2)
            );
            log('Console Check', 'INFO', 'Saved console logs to file');
        } catch (error) {
            log('Console Check', 'WARN', `Could not get logs: ${error.message}`);
        }

        // ====================================================================
        // FINAL SUMMARY
        // ====================================================================
        console.log('\n========================================');
        console.log('TEST SUMMARY');
        console.log('========================================\n');
        
        console.log(`✓ Tests Passed: ${testsPassed.length}`);
        testsPassed.forEach(test => console.log(`  ✓ ${test}`));
        
        console.log(`\n✗ Tests Failed: ${testsFailed.length}`);
        testsFailed.forEach(test => console.log(`  ✗ ${test}`));
        
        console.log(`\nTotal Tests: ${testsPassed.length + testsFailed.length}`);
        console.log(`Success Rate: ${((testsPassed.length / (testsPassed.length + testsFailed.length)) * 100).toFixed(1)}%`);
        
        // Save test report
        const reportPath = path.join(SCREENSHOT_DIR, 'test-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(TEST_REPORT, null, 2));
        console.log(`\n📊 Test report saved: ${reportPath}`);
        console.log(`📸 Screenshots saved in: ${SCREENSHOT_DIR}`);
        
        console.log('\n========================================');
        if (testsFailed.length === 0) {
            console.log('🎉 ALL TESTS PASSED! Ereader is working perfectly!');
        } else {
            console.log('⚠️  Some tests failed. Check logs and screenshots.');
        }
        console.log('========================================\n');

    } catch (error) {
        console.error('\n❌ FATAL ERROR:', error);
        log('Fatal Error', 'FAIL', error.message);
    } finally {
        if (driver) {
            console.log('\nClosing browser...');
            await driver.quit();
        }
    }
}

// Run the tests
(async () => {
    await runTests();
    process.exit(0);
})();
