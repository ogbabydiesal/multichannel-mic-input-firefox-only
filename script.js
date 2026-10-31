let audioCtx = null;
let currentStream = null;
let meterTimer = null;

getDevices.addEventListener('click', search);
options.addEventListener('change', choseMic);

async function search() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    console.log('mediaDevices not available (needs https or localhost)');
    return;
  }

  try {
    // Unlock real labels and device IDs, then release the mic
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();

    options.innerHTML = '';
    const placeholder = new Option('— choose an input —', '');
    placeholder.disabled = true;
    placeholder.selected = true;
    options.appendChild(placeholder);

    devices
      .filter(d => d.kind === 'audioinput')
      .forEach(d => options.appendChild(new Option(d.label || d.deviceId, d.deviceId)));
  } catch (err) {
    console.error(err.name, err.message);
  }
}

async function choseMic() {
  try {
    // Clean up any previous selection
    if (meterTimer) clearInterval(meterTimer);
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    if (audioCtx) await audioCtx.close();

    currentStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        deviceId: { exact: options.value },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 4 },
      },
    });

    const track = currentStream.getAudioTracks()[0];
    const settings = track.getSettings();
    const n = settings.channelCount ?? 2;
    console.log(track.label, n, 'ch @', settings.sampleRate ?? 'default rate');

    audioCtx = settings.sampleRate
      ? new AudioContext({ sampleRate: settings.sampleRate })
      : new AudioContext();
    await audioCtx.resume();
    console.log('context state:', audioCtx.state);

    const source = new MediaStreamAudioSourceNode(audioCtx, { mediaStream: currentStream });
    const splitter = new ChannelSplitterNode(audioCtx, { numberOfOutputs: n });
    const merger = new ChannelMergerNode(audioCtx, { numberOfInputs: 2 });
    const gain = new GainNode(audioCtx, { gain: 30 }); // about +12 dB

    source.connect(splitter);

    // Odd channels (1, 3, ...) → left, even channels (2, 4, ...) → right
    for (let i = 0; i < n; i++) {
      splitter.connect(merger, i, i % 2);
    }
    merger.connect(gain).connect(audioCtx.destination);

    // Per-channel peak meters
    const meters = [...Array(n)].map((_, i) => {
      const a = new AnalyserNode(audioCtx);
      splitter.connect(a, i);
      return a;
    });
    const buf = new Float32Array(2048);
    meterTimer = setInterval(() => {
      console.log(meters.map(a => {
        a.getFloatTimeDomainData(buf);
        return Math.max(...buf.map(Math.abs)).toFixed(3);
      }).join('  '));
    }, 500);
  } catch (err) {
    console.error(err.name, err.message);
  }
}