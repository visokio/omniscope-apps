// main.js

// --- DOM ELEMENTS ---

const projectPathInput = document.getElementById('projectPath');
const loadProjectBtn = document.getElementById('loadProjectBtn');
const paramsContainer = document.getElementById('paramsContainer');

const blocksInput = document.getElementById('blocksInput');
const deleteOnFinishCheckbox = document.getElementById('deleteOnFinish');
const executeBtn = document.getElementById('executeBtn');

const logOutput = document.getElementById('logOutput');

// --- STATE ---

let currentProjectPath = '';
let pollingIntervalId = null;
let lastJobState = null;

// --- LOGGING ---

/**
 * Append a log line with coloured styling.
 * type: "info" | "success" | "error"
 */
function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();

  const line = document.createElement('div');
  line.className = `log-line log-${type}`;

  const tsSpan = document.createElement('span');
  tsSpan.className = 'log-timestamp';
  tsSpan.textContent = `[${timestamp}]`;

  const msgSpan = document.createElement('span');
  msgSpan.textContent = ' ' + message;

  line.appendChild(tsSpan);
  line.appendChild(msgSpan);

  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function clearLogs() {
  logOutput.innerHTML = '';
}

// --- HELPERS ---

function clearPolling() {
  if (pollingIntervalId !== null) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
  lastJobState = null;
}

function buildProjectBaseUrl() {
  // e.g. /workflow-api/Customer+Satisfaction/Dashboard.iox/w
  return `/workflow-api/${currentProjectPath}/w`;
}

// --- PARAM RENDERING ---

function renderParams(paramValues) {
  paramsContainer.innerHTML = '';

  if (!paramValues || paramValues.length === 0) {
    const msg = document.createElement('div');
    msg.textContent = 'No parameters found for this project.';
    paramsContainer.appendChild(msg);
    return;
  }

  paramValues.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'param-row';

    const label = document.createElement('label');
    label.textContent = `${p.name} (${p.type})`;
    label.htmlFor = `param-${p.name}`;

    let input;

    if (p.type === 'BOOLEAN') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `param-${p.name}`;
      input.checked = Boolean(p.value);
    } else if (p.type === 'NUMBER') {
      input = document.createElement('input');
      input.type = 'number';
      input.id = `param-${p.name}`;
      if (p.value !== undefined && p.value !== null) {
        input.value = p.value;
      }
    } else {
      // TEXT, DATE, FILE, FOLDER, etc. – treat as text
      input = document.createElement('input');
      input.type = 'text';
      input.id = `param-${p.name}`;
      if (p.value !== undefined && p.value !== null) {
        input.value = p.value;
      }
    }

    input.dataset.paramName = p.name;
    input.dataset.paramType = p.type;

    row.appendChild(label);
    row.appendChild(input);
    paramsContainer.appendChild(row);
  });
}

// Collect parameter updates from the rendered inputs
function collectParamUpdates() {
  const updates = [];
  const inputs = paramsContainer.querySelectorAll('input[data-param-name]');

  inputs.forEach((input) => {
    const name = input.dataset.paramName;
    const type = input.dataset.paramType;
    let value;

    if (type === 'BOOLEAN') {
      value = input.checked;
    } else if (type === 'NUMBER') {
      if (input.value === '') {
        // Skip empty numeric updates
        return;
      }
      const num = parseFloat(input.value);
      if (Number.isNaN(num)) {
        log(`Skipping param "${name}": invalid number "${input.value}"`, 'error');
        return;
      }
      value = num;
    } else {
      // Treat all other types as text
      if (input.value === '') {
        // Skip empty values (no change)
        return;
      }
      value = input.value;
    }

    updates.push({ name, value });
  });

  return updates;
}

// --- API CALLS ---

async function loadProjectParams() {
  const rawPath = projectPathInput.value.trim();
  if (!rawPath) {
    log('Please enter a project path before loading.', 'error');
    return;
  }

  currentProjectPath = rawPath;
  clearPolling();
  clearLogs();
  paramsContainer.innerHTML = '';

  log(`Loading parameters for project: ${currentProjectPath}`, 'info');

  try {
    const url = `/workflow-api/${currentProjectPath}/w/param`;
    const response = await fetch(url);

    if (!response.ok) {
      log(`Failed to load parameters. HTTP ${response.status}`, 'error');
      return;
    }

    const data = await response.json();
    const paramValues = data.paramValues || [];
    log(`Loaded ${paramValues.length} parameter(s).`, 'success');
    renderParams(paramValues);
  } catch (err) {
    log(`Error loading parameters: ${err.message || err}`, 'error');
  }
}

async function executeLambda() {
  if (!currentProjectPath) {
    log('Please load a project before executing.', 'error');
    return;
  }

  const blocksText = blocksInput.value.trim();
  const blocks = blocksText
    ? blocksText.split(',').map((b) => b.trim()).filter(Boolean)
    : [];

  const deleteExecutionOnFinish = deleteOnFinishCheckbox.checked;
  const updates = collectParamUpdates();

  const requestBody = {
    blocks,
    params: {
      updates,
      waitForIdle: true
    },
    deleteExecutionOnFinish
  };

  log('Submitting lambda execution...', 'info');
  log(`Request body:\n${JSON.stringify(requestBody, null, 2)}`, 'info');

  try {
    const url = `${buildProjectBaseUrl()}/lambdaexecute`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      log(`Lambda execute failed. HTTP ${response.status}`, 'error');
      return;
    }

    const data = await response.json();
    log(`Lambda execute response:\n${JSON.stringify(data, null, 2)}`, 'info');

    if (!data.jobId) {
      if (data.errorType || data.errorMessage) {
        log(
          `Execution could not be started. errorType=${data.errorType || 'N/A'}, errorMessage=${data.errorMessage || 'N/A'}`,
          'error'
        );
      } else {
        log('Execution could not be started. No jobId returned.', 'error');
      }
      return;
    }

    log(`Execution started. Job ID: ${data.jobId}`, 'success');
    startPollingJobState(data.jobId);
  } catch (err) {
    log(`Error executing lambda: ${err.message || err}`, 'error');
  }
}

async function fetchJobState(jobId) {
  const url = `${buildProjectBaseUrl()}/job/${encodeURIComponent(jobId)}/state`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      log(`Failed to fetch job state. HTTP ${response.status}`, 'error');
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    log(`Error fetching job state: ${err.message || err}`, 'error');
    return null;
  }
}

function startPollingJobState(jobId) {
  clearPolling();
  lastJobState = null;

  pollingIntervalId = setInterval(async () => {
    const stateResponse = await fetchJobState(jobId);
    if (!stateResponse) return;

    const jobState = stateResponse.jobState;
    const errorType = stateResponse.errorType;
    const errorMessage = stateResponse.errorMessage;

    if (jobState !== lastJobState) {
      const type =
        jobState === 'COMPLETED'
          ? 'success'
          : jobState === 'FAILED' || jobState === 'CANCELLED'
          ? 'error'
          : 'info';

      let message = `Job ${jobId} state: ${jobState || 'UNKNOWN'}`;
      if (errorType) message += `, errorType=${errorType}`;
      if (errorMessage) message += `, errorMessage=${errorMessage}`;

      log(message, type);
      lastJobState = jobState;
    }

    if (
      jobState === 'COMPLETED' ||
      jobState === 'FAILED' ||
      jobState === 'CANCELLED' ||
      errorType === 'JOB_NOT_FOUND'
    ) {
      const finalType =
        jobState === 'COMPLETED' ? 'success' : 'error';
      log(`Job ${jobId} finished with state: ${jobState || 'UNKNOWN'}`, finalType);
      clearPolling();
    }
  }, 2000);
}

// --- EVENT LISTENERS ---

loadProjectBtn.addEventListener('click', () => {
  loadProjectParams();
});

executeBtn.addEventListener('click', () => {
  executeLambda();
});
