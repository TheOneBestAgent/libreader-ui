// TTS Timing Test Script
// Tests how long it takes to get the first audio segment vs full synthesis

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3001/api/tts';

// Sample chapter text of varying lengths
const SHORT_TEXT = `The morning sun cast long shadows across the village square. 
Elena adjusted her pack and checked the map one final time. The path ahead would be treacherous, 
but she had prepared for this journey her entire life.`;

const MEDIUM_TEXT = `The morning sun cast long shadows across the village square as Elena made her final preparations. 
She had spent months gathering supplies, studying ancient maps, and training her body for the challenges ahead.

The villagers watched from their doorways, some with hope in their eyes, others with barely concealed fear. 
No one had attempted the crossing in over a decade, not since the last expedition had vanished into the mist-shrouded mountains.

"You don't have to do this," her mentor said, placing a weathered hand on her shoulder. 
"The old ways are forgotten for a reason."

Elena smiled, though her heart raced with uncertainty. "That's exactly why I must go. 
Someone has to remember what we've lost."

She shouldered her pack and took the first step on the road that would change everything. 
The wind carried whispers of ancient songs, and somewhere in the distance, a bell tolled three times.

The journey would take weeks, perhaps months. She carried enough provisions for the first leg, 
with plans to forage and hunt along the way. Her sword hung at her hip, more a comfort than a necessity—
or so she hoped.

As the village faded behind her, Elena felt the weight of expectation lift slightly. 
Whatever lay ahead, she would face it on her own terms.`;

const LONG_TEXT = MEDIUM_TEXT + `

Chapter Two: The Forest's Edge

By nightfall, Elena had covered more ground than expected. The road, though overgrown in places, 
remained passable. She made camp beneath an ancient oak, its branches spreading like protective arms overhead.

The fire crackled as she reviewed her notes by its light. The first waypoint was a day's journey ahead—
an abandoned watchtower that once marked the border between the kingdom and the wild lands beyond.

Sleep came fitfully, filled with dreams of shadows and whispered warnings. When dawn broke, 
she rose with renewed determination, though the dreams lingered at the edges of her consciousness.

The forest grew denser as she traveled, the canopy blocking more and more of the sun's rays. 
Strange sounds echoed through the trees—birdsong unlike any she'd heard, and occasionally, 
the crack of branches that suggested something large moving parallel to her path.

She kept her hand near her sword hilt but didn't draw. Whatever watched from the shadows 
seemed content to observe for now.

By midday, she reached a stream and stopped to refill her waterskin. The water ran clear and cold, 
tumbling over moss-covered stones. As she knelt by the bank, she noticed something odd—
symbols carved into a nearby boulder, partially obscured by lichen.

Elena brushed away the growth, revealing an intricate pattern of interlocking circles and lines. 
Her breath caught. She recognized the style from her studies—this was a waymarker, 
left by the original explorers centuries ago.

"I'm on the right path," she murmured, tracing the symbols with her fingertip.

The carvings seemed to pulse with faint warmth, though surely that was just the sun 
filtering through the leaves. She copied the pattern into her journal and continued on, 
her steps lighter than before.

The watchtower appeared as the sun began its descent, a crumbling spire rising above the treeline. 
Most of its upper floors had collapsed, but the base remained intact—solid stone that had 
withstood centuries of neglect.

Elena approached cautiously, alert for any signs of current occupation. The entrance gaped open, 
its wooden door long since rotted away. Inside, she found evidence of previous visitors—
old fire pits, scratched messages on the walls, the bones of small animals.

But nothing recent. She allowed herself to relax slightly and began setting up camp in the most 
sheltered corner of the ground floor.

As darkness fell, she lit her small fire and prepared a simple meal. Tomorrow, she would 
leave the last vestiges of civilization behind and enter truly unknown territory.

The thought should have frightened her. Instead, she felt a strange excitement building in her chest. 
This was what she had been born to do.`;

async function synthesize(text, label) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${label} (${text.length} characters)`);
    console.log('='.repeat(60));
    
    const startTime = Date.now();
    
    try {
        // Submit synthesis job
        const response = await fetch(`${API_BASE}/v1/tts/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                prefer_phonemes: true
            })
        });
        
        if (!response.ok) {
            throw new Error(`Synthesis failed: ${response.status}`);
        }
        
        const job = await response.json();
        const jobId = job.job_id;
        console.log(`Job created: ${jobId}`);
        console.log(`Time to create job: ${Date.now() - startTime}ms`);
        
        // Poll for segments
        let firstSegmentTime = null;
        let allSegmentsTime = null;
        let lastReadyCount = 0;
        let totalSegments = 0;
        
        while (true) {
            const statusResponse = await fetch(`${API_BASE}/v1/tts/jobs/${jobId}`);
            const status = await statusResponse.json();
            const manifest = status.manifest || status;
            const segments = manifest.segments || [];
            totalSegments = segments.length;
            
            const readySegments = segments.filter(s => s.status === 'ready');
            const readyCount = readySegments.length;
            
            // First segment ready
            if (readyCount > 0 && firstSegmentTime === null) {
                firstSegmentTime = Date.now() - startTime;
                console.log(`\n>>> FIRST SEGMENT READY: ${firstSegmentTime}ms <<<`);
                console.log(`    User would hear audio now!`);
            }
            
            // Log new segments
            if (readyCount > lastReadyCount) {
                console.log(`Segments ready: ${readyCount}/${totalSegments} (${Date.now() - startTime}ms)`);
                lastReadyCount = readyCount;
            }
            
            // Check if complete
            if (manifest.status === 'complete') {
                allSegmentsTime = Date.now() - startTime;
                console.log(`\n>>> ALL SEGMENTS COMPLETE: ${allSegmentsTime}ms <<<`);
                break;
            } else if (manifest.status === 'error') {
                console.log('Job failed with error');
                break;
            }
            
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Summary
        console.log(`\n${'─'.repeat(40)}`);
        console.log('TIMING SUMMARY');
        console.log('─'.repeat(40));
        console.log(`Text length:          ${text.length} chars`);
        console.log(`Total segments:       ${totalSegments}`);
        console.log(`Time to first audio:  ${firstSegmentTime}ms (${(firstSegmentTime/1000).toFixed(2)}s)`);
        console.log(`Total synthesis time: ${allSegmentsTime}ms (${(allSegmentsTime/1000).toFixed(2)}s)`);
        console.log(`Time saved:           ${allSegmentsTime - firstSegmentTime}ms (${((allSegmentsTime - firstSegmentTime)/1000).toFixed(2)}s)`);
        console.log(`Improvement:          User hears audio ${((1 - firstSegmentTime/allSegmentsTime) * 100).toFixed(1)}% faster`);
        
        return {
            label,
            textLength: text.length,
            totalSegments,
            firstSegmentTime,
            allSegmentsTime,
            timeSaved: allSegmentsTime - firstSegmentTime
        };
        
    } catch (error) {
        console.error('Test failed:', error.message);
        return null;
    }
}

async function runTests() {
    console.log('TTS Timing Test - Measuring segment streaming performance\n');
    console.log('This test measures how quickly users can start hearing audio');
    console.log('with segment-based streaming vs waiting for full synthesis.\n');
    
    const results = [];
    
    // Test short text
    const shortResult = await synthesize(SHORT_TEXT, 'Short text (~250 chars)');
    if (shortResult) results.push(shortResult);
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test medium text
    const mediumResult = await synthesize(MEDIUM_TEXT, 'Medium text (~1500 chars)');
    if (mediumResult) results.push(mediumResult);
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test long text  
    const longResult = await synthesize(LONG_TEXT, 'Long text (~5000 chars)');
    if (longResult) results.push(longResult);
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('FINAL SUMMARY - All Tests');
    console.log('='.repeat(60));
    console.log('\n| Test | Chars | Segments | First Audio | Total Time | Saved |');
    console.log('|------|-------|----------|-------------|------------|-------|');
    
    for (const r of results) {
        console.log(`| ${r.label.substring(0,20).padEnd(20)} | ${String(r.textLength).padEnd(5)} | ${String(r.totalSegments).padEnd(8)} | ${(r.firstSegmentTime/1000).toFixed(2)}s | ${(r.allSegmentsTime/1000).toFixed(2)}s | ${(r.timeSaved/1000).toFixed(2)}s |`);
    }
    
    console.log('\nConclusion: With segment streaming, users hear audio almost immediately');
    console.log('instead of waiting for the entire chapter to synthesize!');
}

runTests().catch(console.error);
