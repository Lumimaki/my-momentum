const STORAGE_KEY = 'stillpoint.dashboard';
const backgrounds = [
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2400&q=85'
];
const soundNames = {
  lofi: ['Soft keys', 'A quiet chord loop'],
  rain: ['Gentle rain', 'Soft pink noise and rainfall'],
  brown: ['Deep brown', 'A low, steady hush']
};

const elements = {
  clock: document.querySelector('#clock'),
  dateLine: document.querySelector('#date-line'),
  dateCaption: document.querySelector('#date-caption'),
  greeting: document.querySelector('#greeting'),
  name: document.querySelector('#name-input'),
  focusForm: document.querySelector('#focus-form'),
  focusInput: document.querySelector('#focus-input'),
  savedFocus: document.querySelector('#saved-focus'),
  taskForm: document.querySelector('#task-form'),
  taskInput: document.querySelector('#task-input'),
  taskList: document.querySelector('#task-list'),
  taskCount: document.querySelector('#task-count'),
  emptyState: document.querySelector('#empty-state'),
  playButton: document.querySelector('#play-button'),
  playIcon: document.querySelector('#play-icon'),
  trackName: document.querySelector('#track-name'),
  trackStatus: document.querySelector('#track-status'),
  volume: document.querySelector('#volume-input'),
  volumeValue: document.querySelector('#volume-value'),
  soundPanel: document.querySelector('.sound-panel'),
  backgroundButton: document.querySelector('#background-button'),
  timerOrbit: document.querySelector('#timer-orbit'),
  timerDisplay: document.querySelector('#timer-display'),
  breathingCue: document.querySelector('#breathing-cue'),
  timerStatus: document.querySelector('#timer-status'),
  timerStart: document.querySelector('#timer-start'),
  timerPause: document.querySelector('#timer-pause'),
  timerReset: document.querySelector('#timer-reset'),
  toast: document.querySelector('#toast')
};

let state = { name: '', focus: '', focusDate: '', tasks: [], volume: 38, mode: 'lofi', background: 0 };
let toastTimer;
let audioContext;
let masterGain;
let activeSources = [];
let ambientTimer;
let selectedMode = 'lofi';
let isPlaying = false;
let timerDuration = 5 * 60;
let timerRemaining = timerDuration;
let timerDeadline;
let timerInterval;
let timerRunning = false;
let breathingElapsed = 0;
let breathingStartedAt;

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function readState() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY] || {};
  }
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

async function saveState() {
  const snapshot = { ...state };
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 1800);
}

function updateClock() {
  const now = new Date();
  elements.clock.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now);
  const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  elements.dateLine.textContent = fullDate;
  elements.dateCaption.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  elements.greeting.textContent = `${greeting}${state.name ? ',' : '.'}`;
}

function renderFocus() {
  const hasFocus = Boolean(state.focus.trim());
  elements.focusInput.hidden = hasFocus;
  elements.focusForm.querySelector('button').hidden = hasFocus;
  elements.savedFocus.hidden = !hasFocus;
  elements.savedFocus.textContent = state.focus;
  if (hasFocus) {
    const edit = document.createElement('button');
    edit.className = 'text-button';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      elements.focusInput.value = state.focus;
      elements.focusInput.hidden = false;
      elements.focusForm.querySelector('button').hidden = false;
      elements.savedFocus.hidden = true;
      elements.focusInput.focus();
    }, { once: true });
    elements.savedFocus.append(' ', edit);
  }
}

function renderTasks() {
  elements.taskList.replaceChildren();
  for (const task of state.tasks) {
    const item = document.createElement('li');
    item.className = `task-item${task.done ? ' is-done' : ''}`;
    const toggle = document.createElement('button');
    toggle.className = 'task-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', task.done ? `Mark ${task.text} as not done` : `Complete ${task.text}`);
    toggle.textContent = '✓';
    toggle.addEventListener('click', () => {
      task.done = !task.done;
      void saveState();
      renderTasks();
    });
    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    const remove = document.createElement('button');
    remove.className = 'delete-task';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete ${task.text}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.tasks = state.tasks.filter((itemTask) => itemTask.id !== task.id);
      void saveState();
      renderTasks();
    });
    item.append(toggle, text, remove);
    elements.taskList.append(item);
  }
  const remaining = state.tasks.filter((task) => !task.done).length;
  elements.taskCount.textContent = String(remaining);
  elements.emptyState.hidden = state.tasks.length > 0;
}

function applyBackground() {
  const image = backgrounds[state.background % backgrounds.length];
  document.body.style.backgroundImage = `linear-gradient(180deg, rgba(14, 25, 24, .12) 0%, rgba(12, 22, 21, .22) 35%, rgba(9, 17, 17, .7) 100%), url("${image}")`;
}

function updateSoundControls() {
  document.querySelectorAll('.mode-button').forEach((button) => {
    const selected = button.dataset.mode === selectedMode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  elements.trackName.textContent = soundNames[selectedMode][0];
  elements.trackStatus.textContent = isPlaying ? 'Playing gently' : soundNames[selectedMode][1];
  elements.playIcon.textContent = isPlaying ? 'Ⅱ' : '▶';
  elements.playButton.setAttribute('aria-label', isPlaying ? 'Pause focus sounds' : 'Play focus sounds');
  elements.playButton.setAttribute('aria-pressed', String(isPlaying));
  elements.soundPanel.classList.toggle('is-playing', isPlaying);
}

function setVolume(value) {
  const normalized = Number(value) / 100;
  elements.volumeValue.value = `${Math.round(normalized * 100)}%`;
  if (masterGain && audioContext) {
    masterGain.gain.setTargetAtTime(normalized * normalized * 0.55, audioContext.currentTime, 0.08);
  }
}

function ensureAudio() {
  if (audioContext) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio is not available in this browser.');
  audioContext = new AudioContextClass();
  masterGain = audioContext.createGain();
  masterGain.gain.value = (Number(elements.volume.value) / 100) ** 2 * 0.55;
  masterGain.connect(audioContext.destination);
}

function stopCurrentSources() {
  clearTimeout(ambientTimer);
  ambientTimer = undefined;
  for (const source of activeSources) {
    try { source.stop(); } catch { /* The source may already have ended. */ }
    try { source.disconnect(); } catch { /* Some sources are already disconnected. */ }
  }
  activeSources = [];
}

function makeNoiseBuffer(color) {
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, sampleRate * 5, sampleRate);
  const data = buffer.getChannelData(0);
  if (color === 'brown') {
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[index] = last * 3.5;
    }
  } else if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playNoise(mode) {
  const source = audioContext.createBufferSource();
  source.buffer = makeNoiseBuffer(mode === 'brown' ? 'brown' : 'pink');
  source.loop = true;
  const filter = audioContext.createBiquadFilter();
  filter.type = mode === 'brown' ? 'lowpass' : 'lowpass';
  filter.frequency.value = mode === 'brown' ? 350 : 7800;
  source.connect(filter);
  filter.connect(masterGain);
  source.start();
  activeSources.push(source);
  if (mode === 'rain') {
    const rain = audioContext.createBufferSource();
    rain.buffer = makeNoiseBuffer('white');
    rain.loop = true;
    const highpass = audioContext.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 1700;
    const rainGain = audioContext.createGain();
    rainGain.gain.value = 0.08;
    rain.connect(highpass);
    highpass.connect(rainGain);
    rainGain.connect(masterGain);
    rain.start();
    activeSources.push(rain);
  }
}

function playChord(index) {
  const progression = [
    [130.81, 164.81, 196.0, 246.94],
    [110.0, 130.81, 164.81, 196.0],
    [87.31, 130.81, 174.61, 220.0],
    [98.0, 146.83, 174.61, 220.0]
  ];
  const chord = progression[index % progression.length];
  const startAt = audioContext.currentTime + 0.04;
  const duration = 7.8;
  for (const frequency of chord) {
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, startAt);
    envelope.gain.linearRampToValueAtTime(0.13, startAt + 1.2);
    envelope.gain.setValueAtTime(0.13, startAt + duration - 1.1);
    envelope.gain.linearRampToValueAtTime(0, startAt + duration);
    oscillator.connect(envelope);
    envelope.connect(masterGain);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.05);
    activeSources.push(oscillator);
  }
  ambientTimer = setTimeout(() => {
    activeSources = [];
    if (isPlaying && selectedMode === 'lofi') playChord(index + 1);
  }, duration * 1000);
}

async function startSound() {
  try {
    ensureAudio();
    await audioContext.resume();
    stopCurrentSources();
    setVolume(elements.volume.value);
    isPlaying = true;
    updateSoundControls();
    if (selectedMode === 'lofi') playChord(0);
    else playNoise(selectedMode);
  } catch (error) {
    isPlaying = false;
    updateSoundControls();
    showToast(error.message || 'Could not start audio.');
  }
}

function pauseSound() {
  isPlaying = false;
  stopCurrentSources();
  updateSoundControls();
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  const seconds = Math.ceil(timerRemaining);
  elements.timerDisplay.textContent = formatTimer(seconds);
  elements.timerDisplay.setAttribute(
    'aria-label',
    `${Math.floor(seconds / 60)} minutes ${String(seconds % 60).padStart(2, '0')} seconds remaining`
  );
  elements.timerOrbit.classList.toggle('is-active', timerRunning);
  elements.timerStart.disabled = timerRunning;
  elements.timerPause.disabled = !timerRunning;
}

function updateBreathingCue() {
  if (!timerRunning) return;
  const phaseTime = (breathingElapsed + (Date.now() - breathingStartedAt) / 1000) % 14;
  elements.breathingCue.textContent = phaseTime < 4 ? 'Breathe in' : phaseTime < 8 ? 'Hold' : 'Breathe out';
}

function finishMeditation() {
  timerRunning = false;
  timerRemaining = 0;
  clearInterval(timerInterval);
  timerInterval = undefined;
  updateTimerDisplay();
  elements.breathingCue.textContent = 'Session complete';
  elements.timerStatus.textContent = 'Your meditation is complete.';
  void playBowlChime().catch((error) => {
    showToast(error.message || 'Could not play the meditation chime.');
  });
}

function tickTimer() {
  timerRemaining = Math.max(0, (timerDeadline - Date.now()) / 1000);
  if (timerRemaining === 0) {
    finishMeditation();
    return;
  }
  updateTimerDisplay();
  updateBreathingCue();
}

function startMeditation() {
  if (timerRunning) return;
  try {
    ensureAudio();
    void audioContext.resume().catch((error) => {
      showToast(error.message || 'Could not enable the meditation chime.');
    });
  } catch (error) {
    showToast(error.message || 'Could not enable the meditation chime.');
  }
  if (timerRemaining <= 0) {
    timerRemaining = timerDuration;
    breathingElapsed = 0;
  }
  timerRunning = true;
  timerDeadline = Date.now() + timerRemaining * 1000;
  breathingStartedAt = Date.now();
  elements.timerOrbit.style.setProperty('--breathing-delay', `${-breathingElapsed}s`);
  elements.timerStatus.textContent = 'Meditation in progress.';
  updateTimerDisplay();
  updateBreathingCue();
  clearInterval(timerInterval);
  timerInterval = window.setInterval(tickTimer, 200);
}

function pauseMeditation() {
  if (!timerRunning) return;
  timerRemaining = Math.max(0, (timerDeadline - Date.now()) / 1000);
  if (timerRemaining === 0) {
    finishMeditation();
    return;
  }
  breathingElapsed = (breathingElapsed + (Date.now() - breathingStartedAt) / 1000) % 14;
  timerRunning = false;
  clearInterval(timerInterval);
  timerInterval = undefined;
  updateTimerDisplay();
  elements.breathingCue.textContent = 'Take your time';
  elements.timerStatus.textContent = 'Meditation paused.';
}

function resetMeditation(duration = timerDuration) {
  clearInterval(timerInterval);
  timerInterval = undefined;
  timerDuration = duration;
  timerRemaining = duration;
  timerRunning = false;
  breathingElapsed = 0;
  elements.timerOrbit.style.setProperty('--breathing-delay', '0s');
  updateTimerDisplay();
  elements.breathingCue.textContent = 'Ready when you are';
  elements.timerStatus.textContent = '';
}

async function playBowlChime() {
  ensureAudio();
  await audioContext.resume();

  const startAt = audioContext.currentTime + 0.04;
  const endAt = startAt + 10;
  const bowlGain = audioContext.createGain();
  bowlGain.gain.setValueAtTime(0.0001, startAt);
  bowlGain.gain.linearRampToValueAtTime(0.22, startAt + 0.08);
  bowlGain.gain.exponentialRampToValueAtTime(0.0001, endAt);
  bowlGain.connect(audioContext.destination);

  for (const [frequency, level] of [[220, 0.09], [606, 0.035], [1189, 0.012]]) {
    const oscillator = audioContext.createOscillator();
    const partialGain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    partialGain.gain.value = level;
    oscillator.connect(partialGain);
    partialGain.connect(bowlGain);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      partialGain.disconnect();
    }, { once: true });
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.05);
  }

  window.setTimeout(() => bowlGain.disconnect(), 10500);
}

async function initialize() {
  const stored = await readState();
  state = { ...state, ...stored };
  if (state.focusDate !== todayKey()) state.focus = '';
  state.focusDate = todayKey();
  state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
  state.volume = Number.isFinite(Number(state.volume)) ? Number(state.volume) : 38;
  state.background = Number.isInteger(state.background) ? state.background : 0;
  selectedMode = soundNames[state.mode] ? state.mode : 'lofi';
  elements.name.value = state.name;
  elements.focusInput.value = state.focus;
  elements.volume.value = String(state.volume);
  elements.volumeValue.value = `${state.volume}%`;
  updateClock();
  renderFocus();
  renderTasks();
  applyBackground();
  updateSoundControls();
  window.setInterval(updateClock, 1000);
  window.setInterval(() => {
    state.background = (state.background + 1) % backgrounds.length;
    applyBackground();
    void saveState();
  }, 60000);
  await saveState();
}

elements.name.addEventListener('input', () => {
  state.name = elements.name.value.trim();
  updateClock();
  void saveState();
});

elements.focusForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const focus = elements.focusInput.value.trim();
  if (!focus) {
    elements.focusInput.focus();
    return;
  }
  state.focus = focus;
  state.focusDate = todayKey();
  renderFocus();
  void saveState();
  showToast('Focus saved for today.');
});

elements.taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = elements.taskInput.value.trim();
  if (!text) return;
  state.tasks.unshift({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, text, done: false });
  elements.taskInput.value = '';
  renderTasks();
  void saveState();
});

document.querySelectorAll('.mode-button').forEach((button) => {
  button.addEventListener('click', () => {
    selectedMode = button.dataset.mode;
    state.mode = selectedMode;
    updateSoundControls();
    void saveState();
    if (isPlaying) void startSound();
  });
});

elements.playButton.addEventListener('click', () => {
  if (isPlaying) pauseSound();
  else void startSound();
});

elements.volume.addEventListener('input', () => {
  state.volume = Number(elements.volume.value);
  setVolume(state.volume);
  void saveState();
});

elements.backgroundButton.addEventListener('click', () => {
  state.background = (state.background + 1) % backgrounds.length;
  applyBackground();
  void saveState();
});

document.querySelectorAll('.duration-pill').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.duration-pill').forEach((pill) => {
      const selected = pill === button;
      pill.classList.toggle('is-selected', selected);
      pill.setAttribute('aria-pressed', String(selected));
    });
    resetMeditation(Number(button.dataset.duration) * 60);
  });
});

elements.timerStart.addEventListener('click', startMeditation);
elements.timerPause.addEventListener('click', pauseMeditation);
elements.timerReset.addEventListener('click', () => resetMeditation());

updateTimerDisplay();
void initialize();
