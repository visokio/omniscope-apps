// main.js

// --- DOM helpers ---------------------------------------------------------

const projectPathInput = document.getElementById('projectPathInput');
const loadProjectBtn = document.getElementById('loadProjectBtn');
const fileDropZone = document.getElementById('fileDropZone');
const fileInput = document.getElementById('fileInput');
const selectedFileLabel = document.getElementById('selectedFileLabel');
const paramSelect = document.getElementById('paramSelect');
const blocksInput = document.getElementById('blocksInput');
const deleteExecutionCheckbox = document.getElementById('deleteExecutionCheckbox');
const uploadExecuteBtn = document.getElementById('uploadExecuteBtn');
const logOutput = document.getElementById('logOutput');

// --- Simple state --------------------------------------------------------

let selectedFile = null;
let pollIntervalId = null;
let lastJobState = null;
let busy = false;

// --- Logging -------------------------------------------------------------

function log(message, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = isError ? '[ERROR] ' : '';
  logOutput.textContent += `[${timestamp}] ${prefix}${message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

// --- Busy state ----------------------------------------------------------

function setBusy(isBusy) {
  busy = isBusy;
  loadProjectBtn.disabled = isBusy;
  uploadExecuteBtn.disabled = isBusy;
}

// --- Polling -------------------------------------------------------------

function stopPolling() {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  lastJobState = null;
}

function startPollingJob(projectPath, jobId) {
  stopPolling(); // just in case

  log(`Started polling job ${jobId}…`);
  lastJobState = null;

  pollIntervalId = setInterval(async () => {
    try {
      const url = `/workflow-api/${projectPath}/w/job/${encodeURIComponent(
        jobId
      )}/state`;
      const res = await fetch(url);

      if (!res.ok) {
        // Special-case 404: assume transient / eventual consistency issue and KEEP polling
        if (res.status === 404) {
          log('Job state returned 404 – assuming not ready yet, will keep polling…');
          return; // do NOT stop polling or clear busy
        }

        // Other errors: stop polling as before
        log(`Job state request failed with status ${res.status}`, true);
        stopPolling();
        setBusy(false);
        return;
      }

      const data = await res.json();
      const state = data.jobState;

      if (state && state !== lastJobState) {
        log(`Job state: ${state}`);
        lastJobState = state;
      }

      if (
        state === 'COMPLETED' ||
        state === 'FAILED' ||
        state === 'CANCELLED'
      ) {
        if (data.errorType || data.errorMessage) {
          log(
            `Job finished with errorType=${data.errorType || 'N/A'} message=${
              data.errorMessage || 'N/A'
            }`,
            true
          );
        } else {
          log('Job finished.');
        }
        stopPolling();
        setBusy(false);
      }
    } catch (err) {
      log(`Error while checking job state: ${err.message}`, true);
      stopPolling();
      setBusy(false);
    }
  }, 2000);
}

// --- UI reset when loading a new project ---------------------------------

function resetForNewProject() {
  // Stop any ongoing polling
  stopPolling();

  // Clear selected file
  selectedFile = null;
  if (fileInput) {
    fileInput.value = '';
  }
  if (selectedFileLabel) {
    selectedFileLabel.textContent = '';
  }

  // Clear parameter dropdown
  paramSelect.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = 'Load a project to see FILE parameters…';
  paramSelect.appendChild(opt);

  // Clear blocks input
  if (blocksInput) {
    blocksInput.value = '';
  }

  // Clear log
  logOutput.textContent = '';
}

// --- File selection helpers ----------------------------------------------

function setSelectedFile(file) {
  selectedFile = file || null;
  if (!file) {
    selectedFileLabel.textContent = '';
    return;
  }

  const sizeKb = file.size ? Math.round(file.size / 1024) : 0;
  selectedFileLabel.textContent = `Selected: ${file.name} (${sizeKb} KB)`;
}

// --- Event handlers ------------------------------------------------------

// Load project parameters
loadProjectBtn.addEventListener('click', async () => {
  if (busy) return;

  const projectPath = (projectPathInput.value || '').trim();
  if (!projectPath) {
    log('Please enter a project path before loading.', true);
    return;
  }

  resetForNewProject();
  log(`Loading parameters for project: ${projectPath}`);
  setBusy(true);

  try {
    const url = `/workflow-api/${projectPath}/w/param`;
    const res = await fetch(url);

    if (!res.ok) {
      log(`Failed to load parameters. HTTP status: ${res.status}`, true);
      setBusy(false);
      return;
    }

    const data = await res.json();
    const allParams = (data && data.paramValues) || [];
    const fileParams = allParams.filter((p) => p.type === 'FILE');

    paramSelect.innerHTML = '';

    if (fileParams.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No FILE parameters found in this project';
      paramSelect.appendChild(opt);
      log(
        `Loaded ${allParams.length} parameters, but none are of type FILE.`,
        true
      );
      setBusy(false);
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a FILE parameter…';
    paramSelect.appendChild(placeholder);

    fileParams.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      paramSelect.appendChild(opt);
    });

    log(
      `Loaded ${allParams.length} parameters. Found ${fileParams.length} FILE parameter(s).`
    );
  } catch (err) {
    log(`Error while loading parameters: ${err.message}`, true);
  } finally {
    setBusy(false);
  }
});

// File drop zone click → open file chooser
fileDropZone.addEventListener('click', () => {
  if (fileInput) {
    fileInput.click();
  }
});

// File input change
fileInput.addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) {
    setSelectedFile(file);
  }
});

// Drag & drop events
['dragenter', 'dragover'].forEach((eventName) => {
  fileDropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  fileDropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileDropZone.classList.remove('drag-over');
  });
});

fileDropZone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) return;
  const file = dt.files[0];
  setSelectedFile(file);
});

// Upload and execute
uploadExecuteBtn.addEventListener('click', async () => {
  if (busy) return;

  const projectPath = (projectPathInput.value || '').trim();
  if (!projectPath) {
    log('Please enter a project path before executing.', true);
    return;
  }

  if (!selectedFile) {
    log('Please select a file to upload.', true);
    return;
  }

  const paramName = paramSelect.value;
  if (!paramName) {
    log('Please select a FILE parameter to bind the uploaded file to.', true);
    return;
  }

  const blocksRaw = (blocksInput.value || '').trim();
  const blocks = blocksRaw
    ? blocksRaw
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean)
    : [];

  const deleteExecutionOnFinish = !!deleteExecutionCheckbox.checked;

  const execution = {
    blocks, // empty array = all blocks
    params: {
      updates: [
        {
          name: paramName,
          formDataKey: 'uploadedFile_formdata_key',
        },
      ],
    },
    deleteExecutionOnFinish,
  };

  const formData = new FormData();
  formData.append('execution', JSON.stringify(execution));
  formData.append('uploadedFile_formdata_key', selectedFile);

  log(
    `Submitting upload and execute for project: ${projectPath} (param="${paramName}", deleteExecutionOnFinish=${deleteExecutionOnFinish})`
  );
  setBusy(true);

  try {
    const url = `/workflow-api/${projectPath}/w/uploadandexecute`;
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      log(
        `Upload and execute failed. HTTP status: ${res.status} ${
          res.statusText || ''
        }`,
        true
      );
      setBusy(false);
      return;
    }

    const data = await res.json();
    const jobId = data.jobId;

    if (!jobId) {
      log(
        `Upload and execute did not return a jobId. errorType=${
          data.errorType || 'N/A'
        } message=${data.errorMessage || 'N/A'}`,
        true
      );
      setBusy(false);
      return;
    }

    log(`Upload and execute started. Job ID = ${jobId}`);
    startPollingJob(projectPath, jobId);
  } catch (err) {
    log(`Error during upload and execute: ${err.message}`, true);
    setBusy(false);
  }
});

// Initial log
log('Ready. Enter a project path, then click "Load project parameters".');
