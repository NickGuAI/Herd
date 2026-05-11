# @gehirn/transcription

Provider-agnostic transcription package with OpenAI and Gemini adapters, consensus orchestration, and chunking utilities.

## Features

- `TranscriptionProvider` interface
- OpenAI adapter (`OpenAITranscriptionProvider`)
- Gemini adapter (`GeminiTranscriptionProvider`)
- Consensus transcriber (`ConsensusTranscriptionProvider`)
- Audio chunking helper (`splitAudio`)
- Duration helper contract (`getAudioDuration`)

## Providers

- OpenAI (implemented adapter)
- Gemini (implemented adapter)
- Consensus / multi-provider merge (implemented)

## Usage

```ts
import {
  OpenAITranscriptionProvider,
  splitAudio
} from "@gehirn/transcription";

const provider = new OpenAITranscriptionProvider(openAIClient);
const result = await provider.transcribe("/tmp/meeting.wav", {
  model: "gpt-4o-transcribe"
});

const chunks = await splitAudio("/tmp/meeting.wav", "/tmp/chunks", {
  durationSeconds: 1800
});

console.log(result.title, chunks.length);
```
