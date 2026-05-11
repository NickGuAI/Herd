import assert from "node:assert/strict";
import test from "node:test";

import {
  ConsensusTranscriptionProvider,
  splitAudio
} from "../dist/index.js";

test("splitAudio creates overlapping chunks", async () => {
  const chunks = await splitAudio("audio.wav", "chunks", {
    durationSeconds: 1250,
    chunkDurationSeconds: 600,
    overlapSeconds: 15
  });

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].startSecond, 0);
  assert.equal(chunks[1].startSecond, 585);
  assert.equal(chunks[2].endSecond, 1250);
});

test("ConsensusTranscriptionProvider merges results", async () => {
  const provider = new ConsensusTranscriptionProvider([
    {
      provider: "openai",
      async transcribe() {
        return {
          title: "Team Meeting",
          summary: "Summary A",
          segments: [{ content: "hello" }]
        };
      }
    },
    {
      provider: "gemini",
      async transcribe() {
        return {
          title: "Team Meeting",
          summary: "Summary B",
          segments: [{ content: "world" }]
        };
      }
    }
  ]);

  const result = await provider.transcribe("audio.wav");
  assert.equal(result.segments.length, 2);
  assert.equal(result.summary.includes("Summary A"), true);
  assert.equal(result.summary.includes("Summary B"), true);
});
