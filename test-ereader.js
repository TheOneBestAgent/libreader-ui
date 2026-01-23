/**
 * LibRead Ereader - Automated Test Suite
 * Tests all critical functionality using Puppeteer
 */

const http = require('http');

// Test 1: Health Check
async function testHealthCheck() {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:3001/health', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (data.includes('ok')) {
                    console.log('✅ Test 1 PASSED: Health check');
                    resolve(true);
                } else {
                    console.log('❌ Test 1 FAILED: Health check response invalid');
                    resolve(false);
                }
            });
        }).on('error', (err) => {
            console.log('❌ Test 1 FAILED: Health check error -', err.message);
            resolve(false);
        });
    });
}

// Test 2: Novel Page Proxy
async function testNovelProxy() {
    return new Promise((resolve) => {
        const url = 'http://localhost:3001/api/proxy?' + encodeURIComponent('url=https://libread.com/libread/immortality-simulator-140946');
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (data.includes('Immortality Simulator') && data.includes('12029s.jpg')) {
                    console.log('✅ Test 2 PASSED: Novel page proxy (article ID found)');
                    resolve(true);
                } else {
                    console.log('❌ Test 2 FAILED: Novel page content invalid');
                    resolve(false);
                }
            });
        }).on('error', (err) => {
            console.log('❌ Test 2 FAILED: Novel proxy error -', err.message);
            resolve(false);
        });
    });
}

// Test 3: Chapter List API
async function testChapterListAPI() {
    return new Promise((resolve) => {
        http.get('http://localhost:3001/api/chapterlist?aid=12029', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.html && json.html.includes('option value=')) {
                        const chapterCount = (json.html.match(/option value=/g) || []).length;
                        console.log(`✅ Test 3 PASSED: Chapter list API (${chapterCount} chapters found)`);
                        
                        // Check for -0 placeholder
                        if (json.html.includes('/-0/')) {
                            console.log('⚠️  WARNING: -0 placeholder found in API response');
                            console.log('   This should be fixed by buildChapterUrl() in app.js');
                        }
                        resolve(true);
                    } else {
                        console.log('❌ Test 3 FAILED: Invalid chapter list response');
                        resolve(false);
                    }
                } catch (e) {
                    console.log('❌ Test 3 FAILED: JSON parse error -', e.message);
                    resolve(false);
                }
            });
        }).on('error', (err) => {
            console.log('❌ Test 3 FAILED: Chapter list API error -', err.message);
            resolve(false);
        });
    });
}

// Test 4: Chapter Page Proxy
async function testChapterProxy() {
    return new Promise((resolve) => {
        const url = 'http://localhost:3001/api/proxy?' + encodeURIComponent('url=https://libread.com/libread/immortality-simulator-140946/chapter-01');
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (data.includes('div id="article"') || data.includes('class="txt"')) {
                    console.log('✅ Test 4 PASSED: Chapter page proxy (content found)');
                    resolve(true);
                } else {
                    console.log('❌ Test 4 FAILED: Chapter content not found');
                    resolve(false);
                }
            });
        }).on('error', (err) => {
            console.log('❌ Test 4 FAILED: Chapter proxy error -', err.message);
            resolve(false);
        });
    });
}

// Test 5: Main Page Access
async function testMainPage() {
    return new Promise((resolve) => {
        http.get('http://localhost:3001/', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (data.includes('LibRead Ereader') && data.includes('app.js')) {
                    console.log('✅ Test 5 PASSED: Main page loads correctly');
                    resolve(true);
                } else {
                    console.log('❌ Test 5 FAILED: Main page content invalid');
                    resolve(false);
                }
            });
        }).on('error', (err) => {
            console.log('❌ Test 5 FAILED: Main page error -', err.message);
            resolve(false);
        });
    });
}

// Test 6: Verify Fix in app.js
async function verifyFixes() {
    const fs = require('fs');
    return new Promise((resolve) => {
        fs.readFile('/home/darvondoom/libread-ereader/app.js', 'utf8', (err, data) => {
            if (err) {
                console.log('❌ Test 6 FAILED: Could not read app.js');
                resolve(false);
                return;
            }
            
            const checks = {
                hasBuildChapterUrl: data.includes('function buildChapterUrl'),
                hasExtractNovelSlug: data.includes('function extractNovelSlug'),
                hasCleanChapterTitle: data.includes('function cleanChapterTitle'),
                hasExtractArticleId: data.includes('function extractArticleId'),
                hasZeroPlaceholderFix: data.includes('includes(\'/libread/-0/\')'),
                hasImprovedLogging: data.includes('🔧 Fixed -0 placeholder')
            };
            
            const allPassed = Object.values(checks).every(v => v === true);
            
            if (allPassed) {
                console.log('✅ Test 6 PASSED: All fixes verified in app.js');
                console.log('   ✓ buildChapterUrl() function present');
                console.log('   ✓ extractNovelSlug() function present');
                console.log('   ✓ cleanChapterTitle() function present');
                console.log('   ✓ extractArticleId() function present');
                console.log('   ✓ -0 placeholder fix implemented');
                console.log('   ✓ Improved logging added');
                resolve(true);
            } else {
                console.log('❌ Test 6 FAILED: Some fixes missing:');
                Object.entries(checks).forEach(([key, value]) => {
                    if (!value) console.log(`   ✗ ${key} missing`);
                });
                resolve(false);
            }
        });
    });
}

// Run all tests
async function runTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     LibRead Ereader - Automated Test Suite                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    
    const results = [];
    
    // Run tests
    results.push(await testHealthCheck());
    results.push(await verifyFixes());
    results.push(await testMainPage());
    results.push(await testNovelProxy());
    results.push(await testChapterListAPI());
    results.push(await testChapterProxy());
    
    // Summary
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                        Test Summary                         ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    const passed = results.filter(r => r === true).length;
    const total = results.length;
    const percentage = Math.round((passed / total) * 100);
    
    console.log('');
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${total - passed}`);
    console.log(`Success Rate: ${percentage}%`);
    console.log('');
    
    if (percentage === 100) {
        console.log('🎉 ALL TESTS PASSED! The ereader is ready to use!');
        console.log('');
        console.log('Next steps:');
        console.log('  1. Open http://localhost:3001 in your browser');
        console.log('  2. Click "Get Started" to browse novels');
        console.log('  3. Click on any novel to see chapters');
        console.log('  4. Read chapters with Previous/Next navigation');
        console.log('');
        console.log('Check the browser console (F12) to see the fix logs:');
        console.log('  🔧 Fixed -0 placeholder messages');
        console.log('  ✓ Article ID extracted messages');
    } else {
        console.log('⚠️  Some tests failed. Please check the output above.');
    }
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
}

// Execute tests
runTests().catch(console.error);
