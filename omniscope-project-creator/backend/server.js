import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

// ES module helpers to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config.json
const configPath = path.join(__dirname, 'config.json');
let config;

try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(raw);
  console.log('Loaded config:', config);
} catch (err) {
  console.error('Failed to load config.json:', err.message);
  process.exit(1);
}

// Ensure upload directory exists
try {
  fs.mkdirSync(config.uploadRootPath, { recursive: true });
  console.log('Ensured upload directory exists:', config.uploadRootPath);
} catch (err) {
  console.error('Failed to ensure upload directory:', err.message);
  process.exit(1);
}

const app = express();
const PORT = 3000;

// Optional: JSON / urlencoded parsers for other endpoints if needed
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer storage to use the configured uploadRootPath
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.uploadRootPath);
  },
  filename: (req, file, cb) => {
    // Keep original filename for now
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    omniscopeBaseUrl: config.omniscopeBaseUrl,
    projectApiBaseUrl: config.projectApiBaseUrl,
    uploadRootPath: config.uploadRootPath,
    templateId: config.templateId,
    fileParamName: config.fileParamName
  });
});

// Helper to normalise base URL (avoid double slashes)
function getCreateEndpoint() {
  let base = config.projectApiBaseUrl || '';
  if (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  return `${base}/create`;
}

// Accepts a single file under field name "file"
app.post('/api/create-project', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded. Expected field name "file".'
    });
  }

  const fileInfo = {
    originalName: req.file.originalname,
    storedPath: req.file.path,
    size: req.file.size
  };

  console.log('Received file:', fileInfo);

  // Derive a project name from the file name
  const baseName = path.parse(req.file.originalname).name;
  const projectName = baseName;

  // If we are embedding, move the file into <name>.data/embed/
  if (config.isEmbedded) {
    const embedDir  = path.join(config.uploadRootPath, `${projectName}.iox.data`, 'embed');

    // Ensure the embed directory exists
    fs.mkdirSync(embedDir , {recursive: true});

    const newPath = path.join(embedDir, req.file.originalname);

    // Move the file from the initial upload location to the embed folder
    fs.renameSync(req.file.path, newPath);

    // Update stored path info
    req.file.path = newPath;
    fileInfo.storedPath = newPath

    console.log('Moved file to embed folder:', newPath);
  }


  // Build the ProjectApiCreateRequest body
  const createRequestBody = {
    name: projectName,
    templateId: config.templateId,
    parameters: {
      // Use whatever the template's file parameter name is
      [config.fileParamName]: config.isEmbedded ? req.file.originalname : req.file.path
      // If your template expects a different value
      // (e.g. relative path), adjust this line accordingly.
    }
  };

  console.log(createRequestBody);

  const endpoint = getCreateEndpoint();
  console.log('Calling Project API /create at:', endpoint);
  console.log('Create request body:', createRequestBody);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // Add auth headers here if your Omniscope server requires them
        // e.g. Authorization: `Basic ...`
      },
      body: JSON.stringify(createRequestBody)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('Project API error status:', response.status, text);
      return res.status(502).json({
        error: 'Project API /create returned an error',
        status: response.status,
        body: text
      });
    }

    const projectResponse = await response.json().catch(() => null);

    console.log('Project API /create response:', projectResponse);

    return res.json({
      message: 'Project created successfully.',
      file: fileInfo,
      project: projectResponse
    });
  } catch (err) {
    console.error('Error calling Project API /create:', err);
    return res.status(500).json({
      error: 'Failed to call Project API /create',
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});
