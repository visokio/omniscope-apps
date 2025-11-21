import './style.css'

// --- DOM references ---
const logOutput = document.getElementById('logOutput')
const projectPathInput = document.getElementById('projectPath')
const loadParamsBtn = document.getElementById('loadParamsBtn')
const updateParamsBtn = document.getElementById('updateParamsBtn')
const executeWorkflowBtn = document.getElementById('executeWorkflowBtn')
const paramsContainer = document.getElementById('paramsContainer')

// Track which project / job we’re working with
let currentProjectPath = null
let currentJobId = null
let jobPollTimer = null

// --- Logging ---

function log(message, type = 'info') {
  const entry = document.createElement('div')
  entry.className = `log-entry log-${type}`

  const tsSpan = document.createElement('span')
  tsSpan.className = 'log-timestamp'
  tsSpan.textContent = `[${new Date().toLocaleString()}]`

  const msgSpan = document.createElement('span')
  msgSpan.className = 'log-message'
  msgSpan.textContent = ' ' + message

  entry.appendChild(tsSpan)
  entry.appendChild(msgSpan)

  logOutput.appendChild(entry)
  logOutput.scrollTop = logOutput.scrollHeight
}

log('App initialised. Enter a project path and click "Load parameters".')

// --- Helpers ---

function buildWorkflowUrl(projectPath) {
  // Uses the Vite proxy: /workflow-api → http://127.0.0.1:24679
  return `/workflow-api/${projectPath}/w`
}

async function apiGet(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GET ${url} failed: HTTP ${res.status} – ${text}`)
  }
  return res.json()
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${url} failed: HTTP ${res.status} – ${text}`)
  }
  return res.json()
}

// --- Render parameters ---

function renderParams(paramValues) {
  if (!paramValues || paramValues.length === 0) {
    paramsContainer.innerHTML = '<p>No parameters found.</p>'
    return
  }

  paramsContainer.innerHTML = ''

  paramValues.forEach((param) => {
    const row = document.createElement('div')
    row.className = 'param-row'

    const value =
      param.value !== undefined && param.value !== null ? param.value : ''

    row.innerHTML = `
      <label class="field">
        <span><strong>${param.name}</strong> (${param.type})</span>
        <input
          class="param-input"
          data-param-name="${param.name}"
          value="${String(value)}"
        />
      </label>
    `

    paramsContainer.appendChild(row)
  })
}

// --- Job polling ---

function clearJobPolling() {
  if (jobPollTimer) {
    clearInterval(jobPollTimer)
    jobPollTimer = null
  }
  currentJobId = null
}

function startJobPolling(apiBase, jobId) {
  clearJobPolling()
  currentJobId = jobId

  const jobUrl = `${apiBase}/job/${encodeURIComponent(jobId)}/state`

  async function poll() {
    try {
      const data = await apiGet(jobUrl)
      const state = data.jobState || 'UNKNOWN'
      const errorType = data.errorType
      const errorMessage = data.errorMessage

      log(
        `Job ${jobId} state: ${state}` +
          (errorType ? ` (errorType=${errorType})` : '') +
          (errorMessage ? ` – ${errorMessage}` : ''),
        state === 'FAILED' || state === 'CANCELLED' ? 'error' : 'info'
      )

      // Terminal states
      if (
        state === 'COMPLETED' ||
        state === 'FAILED' ||
        state === 'CANCELLED' ||
        errorType === 'JOB_NOT_FOUND'
      ) {
        clearJobPolling()
        log(
          `Job ${jobId} finished with state: ${state}` +
            (errorType ? ` (errorType=${errorType})` : ''),
          state === 'COMPLETED' ? 'success' : 'error'
        )
        executeWorkflowBtn.disabled = false
        updateParamsBtn.disabled = false
      }
    } catch (err) {
      log(`Error polling job ${jobId}: ${err.message}`, 'error')
      clearJobPolling()
      executeWorkflowBtn.disabled = false
      updateParamsBtn.disabled = false
    }
  }

  // Poll immediately, then every 2 seconds
  poll()
  jobPollTimer = setInterval(poll, 2000)
}

// --- Event handlers ---

// 1) Load parameters
loadParamsBtn.addEventListener('click', async () => {
  const projectPath = projectPathInput.value.trim()

  if (!projectPath) {
    log('Please enter a project path.', 'error')
    return
  }

  const apiBase = buildWorkflowUrl(projectPath)
  const paramsUrl = `${apiBase}/param`

  log(`Loading parameters from: ${paramsUrl}`)

  loadParamsBtn.disabled = true
  updateParamsBtn.disabled = true
  executeWorkflowBtn.disabled = true

  try {
    const data = await apiGet(paramsUrl)
    renderParams(data.paramValues || [])

    currentProjectPath = projectPath

    updateParamsBtn.disabled = false
    executeWorkflowBtn.disabled = false

    log(
      `Loaded ${
        data.paramValues ? data.paramValues.length : 0
      } parameters for project "${projectPath}".`,
      'success'
    )
  } catch (err) {
    log(`Error loading parameters: ${err.message}`, 'error')
    paramsContainer.innerHTML =
      '<p class="error">Failed to load parameters. See log for details.</p>'
  } finally {
    loadParamsBtn.disabled = false
  }
})

// 2) Update parameters
updateParamsBtn.addEventListener('click', async () => {
  if (!currentProjectPath) {
    log('No project loaded. Load parameters first.', 'error')
    return
  }

  const apiBase = buildWorkflowUrl(currentProjectPath)
  const updateUrl = `${apiBase}/updateparams`

  const inputs = paramsContainer.querySelectorAll('.param-input')
  const updates = Array.from(inputs).map((input) => ({
    name: input.dataset.paramName,
    value: input.value, // send as string; Omniscope will coerce
  }))

  const body = {
    updates,
    waitForIdle: true,
  }

  log(
    `Updating ${updates.length} parameter(s) via: ${updateUrl}\nRequest body: ${JSON.stringify(
      body
    )}`,
    'info'
  )

  updateParamsBtn.disabled = true

  try {
    const response = await apiPost(updateUrl, body)

    if (response.status === 'SUCCESS') {
      log('Parameters updated successfully.', 'success')
    } else {
      log(
        `Parameter update failed. status=${response.status}, errorType=${response.errorType}, errorMessage=${response.errorMessage}`,
        'error'
      )
    }
  } catch (err) {
    log(`Error updating parameters: ${err.message}`, 'error')
  } finally {
    updateParamsBtn.disabled = false
  }
})

// 3) Execute workflow
executeWorkflowBtn.addEventListener('click', async () => {
  if (!currentProjectPath) {
    log('No project loaded. Load parameters first.', 'error')
    return
  }

  const apiBase = buildWorkflowUrl(currentProjectPath)
  const executeUrl = `${apiBase}/execute`

  // Minimal ExecuteWorkflowRequest:
  // - empty blocks = run all
  // - don't refresh from source
  // - don't cancel existing
  // - waitForIdle = true
  const body = {
    blocks: [],
    refreshFromSource: false,
    cancelExisting: false,
    waitForIdle: true,
  }

  log(
    `Triggering workflow execution via: ${executeUrl}\nRequest body: ${JSON.stringify(
      body
    )}`,
    'info'
  )

  executeWorkflowBtn.disabled = true
  updateParamsBtn.disabled = true
  clearJobPolling()

  try {
    const response = await apiPost(executeUrl, body)

    if (!response.jobId) {
      log(
        `Failed to start workflow execution. errorType=${response.errorType}, errorMessage=${response.errorMessage}`,
        'error'
      )
      executeWorkflowBtn.disabled = false
      updateParamsBtn.disabled = false
      return
    }

    log(`Workflow execution started. jobId=${response.jobId}`, 'success')

    // Start polling job state
    startJobPolling(apiBase, response.jobId)
  } catch (err) {
    log(`Error executing workflow: ${err.message}`, 'error')
    executeWorkflowBtn.disabled = false
    updateParamsBtn.disabled = false
  }
})
