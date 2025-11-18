// script.js

const resultDiv = document.getElementById('result');
const getJobsBtn = document.getElementById('get-jobs-btn');
const executeBtn = document.getElementById('execute-task-btn');
const cancelBtn = document.getElementById('cancel-job-btn');
const taskInput = document.getElementById('task-name');

const BASE = '/scheduler-api'; // proxied path

let currentJobId = null;
let pollTimer = null;

function log(message) {
  resultDiv.textContent += message + '\n';
}

function clearLog() {
  resultDiv.textContent = '';
}

function setRunningState(isRunning) {
  if (executeBtn) executeBtn.disabled = isRunning;
  if (cancelBtn) cancelBtn.disabled = !isRunning;
}

// ---------------------------
// GET /all/ — test endpoint
// ---------------------------

getJobsBtn?.addEventListener('click', async () => {
  clearLog();

  const url = `${BASE}/all/`;

  log(`Calling: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    log(`HTTP status: ${response.status}`);

    if (!response.ok) {
      log(await response.text());
      return;
    }

    const jobs = await response.json();
    log(`Number of jobs returned: ${jobs.length}`);
  } catch (err) {
    log('Request failed. Check console.');
    console.error(err);
  }
});

// ---------------------------
// Job polling helpers
// ---------------------------

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(jobId) {
  stopPolling(); // safety

  log(`Started polling job ${jobId} every 1s`);

  pollTimer = setInterval(async () => {
    const url = `${BASE}/job/${encodeURIComponent(jobId)}/`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        log(`Status check failed (HTTP ${response.status}). Stopping polling.`);
        stopPolling();
        setRunningState(false);
        currentJobId = null;
        return;
      }

      const job = await response.json();
      const time = new Date().toLocaleTimeString();
      log(`[${time}] Status: ${job.status}`);

      // Terminal states: stop polling and re-enable execute
      if (job.status === 'COMPLETED' ||
          job.status === 'FAILED' ||
          job.status === 'CANCELLED') {
        log(`Job finished with status: ${job.status}`);
        stopPolling();
        setRunningState(false);
        currentJobId = null;
      }

    } catch (err) {
      log('Error checking job status. Stopping polling. See console.');
      console.error(err);
      stopPolling();
      setRunningState(false);
      currentJobId = null;
    }
  }, 1000); // every second
}

// ---------------------------
// POST /task/{taskName}/execute/
// ---------------------------

executeBtn?.addEventListener('click', async () => {
  clearLog();

  const taskName = taskInput.value.trim();
  if (!taskName) {
    log('Please enter a task name.');
    return;
  }

  const url = `${BASE}/task/${encodeURIComponent(taskName)}/execute/`;

  log(`Executing task: "${taskName}"`);
  log(`POST ${url}`);

  try {
    const response = await fetch(url, { method: 'POST' });

    log(`HTTP status: ${response.status}`);

    if (!response.ok) {
      log(await response.text());
      return;
    }

    const jobIdRaw = await response.text();
    const jobId = jobIdRaw.trim();

    if (!jobId) {
      log('No job ID returned from server.');
      return;
    }

    log(`Job started. Job ID = ${jobId}`);

    currentJobId = jobId;
    setRunningState(true);
    startPolling(jobId);

  } catch (err) {
    log('Request failed. Check console.');
    console.error(err);
  }
});

// ---------------------------
// DELETE /job/{jobId}/ — cancel
// ---------------------------

cancelBtn?.addEventListener('click', async () => {
  if (!currentJobId) {
    log('No active job to cancel.');
    return;
  }

  const jobId = currentJobId;
  const url = `${BASE}/job/${encodeURIComponent(jobId)}/`;

  log(`Requesting cancel for job ${jobId}`);
  log(`DELETE ${url}`);

  try {
    const response = await fetch(url, { method: 'DELETE' });

    log(`HTTP status: ${response.status}`);

    if (!response.ok) {
      log(await response.text());
      return;
    }

    // We keep polling; the next status check should show CANCELLED.
    log('Cancel request sent. Waiting for job to report CANCELLED...');
  } catch (err) {
    log('Cancel request failed. Check console.');
    console.error(err);
  }
});
