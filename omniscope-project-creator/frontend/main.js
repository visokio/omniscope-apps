// frontend/main.js

let omniscopeBaseUrl = null;
let selectedFile = null;

function setupDropArea() {
  const dropArea = document.querySelector('.drop-area');
  const createButton = document.getElementById('createProjectBtn');
  const statusEl = document.getElementById('status');

  if (!dropArea) {
    console.error('Drop area element not found');
    return;
  }

  const preventDefaults = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const highlight = () => {
    dropArea.style.borderColor = '#0077ff';
    dropArea.style.background = '#eef5ff';
  };

  const unhighlight = () => {
    dropArea.style.borderColor = '#999';
    dropArea.style.background = '#fff';
  };

  const handleDrop = (event) => {
    preventDefaults(event);
    unhighlight();

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      console.log('No files dropped');
      return;
    }

    const file = files[0];
    selectedFile = file;
    console.log('Dropped file:', file);

    dropArea.textContent = `Selected file: ${file.name} (${formatFileSize(
      file.size
    )})`;

    if (createButton) {
      createButton.disabled = false;
    }

    if (statusEl) {
      statusEl.textContent = '';
    }
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropArea.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropArea.addEventListener(eventName, highlight, false);
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropArea.addEventListener(eventName, unhighlight, false);
  });

  dropArea.addEventListener('drop', handleDrop, false);

  if (createButton) {
    createButton.addEventListener('click', async () => {
      if (!selectedFile) {
        if (statusEl) {
          statusEl.textContent = 'Please drop a file first.';
        }
        return;
      }

      createButton.disabled = true;
      if (statusEl) {
        statusEl.textContent = 'Uploading file and creating project...';
      }

      try {
        const formData = new FormData();
        // Field name "file" – backend will expect this
        formData.append('file', selectedFile);

        const response = await fetch('/api/create-project', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();

        console.log('Create project response:', data);

        if (statusEl) {
            if (data.error) {
                statusEl.textContent = `Error from server: ${data.error}`;
            } else if (data.project && data.project.name && data.project.path) {
                statusEl.textContent = `Project created: ${data.project.name} (path: ${data.project.path})`;
                const fullUrl = omniscopeBaseUrl + data.project.path;
                window.open(fullUrl, '_blank');
            } else if (data.message) {
                statusEl.textContent = data.message;
            } else {
                statusEl.textContent =
                'File uploaded and request sent, but no project details were returned.';
            }
        }
      } catch (err) {
        console.error(err);
        if (statusEl) {
          statusEl.textContent = `Error: ${err.message}`;
        }
      } finally {
        if (createButton) {
          createButton.disabled = false;
        }
      }
    });
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, index);
  return `${size.toFixed(1)} ${units[index]}`;
}

async function loadConfig() {
  const res = await fetch('/api/health');
  const data = await res.json();
  omniscopeBaseUrl = data.omniscopeBaseUrl;
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  setupDropArea();
});
