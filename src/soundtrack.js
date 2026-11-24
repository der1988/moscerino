import soundtrackUrl from '../The Chosen One.mp3?url'

export { soundtrackUrl }

// The matching phrases are 288 beats apart, at approximately 97 BPM.
const LOOP_START = 25.782
const LOOP_END = 203.737
const CROSSFADE = 0.14

function blendLoopBoundary(buffer, start, end) {
  const overlap = Math.round(CROSSFADE * buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let i = 0; i < overlap; i++) {
      const blend = i / (overlap - 1) * Math.PI / 2
      const tail = end - overlap + i
      const head = start - overlap + i
      samples[tail] = samples[tail] * Math.cos(blend) + samples[head] * Math.sin(blend)
    }
  }
}

export async function startSoundtrack(context, url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Soundtrack HTTP ${response.status}`)
  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  const start = Math.round(LOOP_START * buffer.sampleRate)
  const end = Math.round(LOOP_END * buffer.sampleRate)
  blendLoopBoundary(buffer, start, end)

  const source = context.createBufferSource()
  const gain = context.createGain()
  gain.gain.value = 0.14
  source.buffer = buffer
  source.loop = true
  source.loopStart = start / buffer.sampleRate
  source.loopEnd = end / buffer.sampleRate
  source.connect(gain).connect(context.destination)
  source.start()
  return source
}
