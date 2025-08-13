// server.js
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ----- Jira client -----
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_BASE_URL || !JIRA_USER_EMAIL || !JIRA_API_TOKEN) {
  console.error('Missing Jira env vars. Set JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN.');
  process.exit(1);
}

const jira = axios.create({
  baseURL: `${JIRA_BASE_URL}/rest/api/3`,
  auth: {
    username: JIRA_USER_EMAIL,
    password: JIRA_API_TOKEN,
  }
});

// ---- Utility: find the field id of "Epic Name" for this site/project
async function getEpicNameFieldId(projectKey) {
  // Ask Jira what fields are required to create an Epic in this project
  const { data } = await jira.get(
    `/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeNames=Epic&expand=projects.issuetypes.fields`
  );

  const project = data.projects?.[0];
  const epicType = project?.issuetypes?.find(t => t.name === 'Epic');
  const fields = epicType?.fields || {};

  // Look for a field whose name is "Epic Name"
  for (const [fieldId, fieldDef] of Object.entries(fields)) {
    if (/^epic name$/i.test(fieldDef.name)) {
      return fieldId; // e.g., customfield_10011
    }
  }
  // Fallback to the common default if not found
  return 'customfield_10011';
}

// ---- Utility: create an Epic
async function createEpic({ summary, projectKey, epicName }) {
  const epicNameFieldId = await getEpicNameFieldId(projectKey);

  const payload = {
    fields: {
      summary,
      issuetype: { name: 'Epic' },
      project: { key: projectKey },
      [epicNameFieldId]: epicName || summary
    }
  };

  const { data } = await jira.post('/issue', payload);
  return data; // { id, key, ... }
}

// ---- Utility: find issues under an epic (works for both company-managed and team-managed)
async function fetchEpicChildren(epicKey) {
  // Try Parent Epic JQL first (works broadly)
  const jqls = [
    `parentEpic = ${epicKey}`,
    `"Epic Link" = ${epicKey}` // fallback for classic projects
  ];

  for (const jql of jqls) {
    const { data } = await jira.get('/search', {
      params: {
        jql,
        fields: 'summary,issuetype'
      }
    });
    if (data.issues && data.issues.length > 0) return data.issues;
  }

  return []; // none found
}

// ---- Utility: create an issue under an epic, copying type & summary
async function createChildIssue({ projectKey, parentEpicKey, templateIssue }) {
  const payload = {
    fields: {
      project: { key: projectKey },
      summary: templateIssue.fields.summary,
      issuetype: { id: templateIssue.fields.issuetype.id },
      parent: { key: parentEpicKey } // This attaches the issue to the Epic
    }
  };

  const { data } = await jira.post('/issue', payload);
  return data; // { id, key, ... }
}

// ---- API ----

// Health
app.get('/', (_, res) => res.send('Slepsk Prod API is live. POST /clone-epic to clone an epic.'));

// Clone endpoint
app.post('/clone-epic', async (req, res) => {
  const { templateEpicKey, targetProjectKey, newEpicSummary } = req.body || {};

  if (!templateEpicKey || !targetProjectKey || !newEpicSummary) {
    return res.status(400).json({
      error: 'Missing required fields: templateEpicKey, targetProjectKey, newEpicSummary'
    });
  }

  try {
    // 1) Create the new epic
    const newEpic = await createEpic({
      summary: newEpicSummary,
      projectKey: targetProjectKey,
      epicName: newEpicSummary
    });

    // 2) Load children of the template epic
    const children = await fetchEpicChildren(templateEpicKey);

    // 3) Re-create each as a child of the new epic
    const createdChildren = [];
    for (const child of children) {
      const created = await createChildIssue({
        projectKey: targetProjectKey,
        parentEpicKey: newEpic.key,
        templateIssue: child
      });
      createdChildren.push(created.key);
    }

    res.json({
      ok: true,
      newEpicKey: newEpic.key,
      createdChildren
    });
  } catch (err) {
    console.error('Clone failed:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to clone epic. See server logs.',
      details: err?.response?.data || err.message
    });
  }
});

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
