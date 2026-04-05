const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const CRM_PASSWORD = process.env.CRM_PASSWORD;

const headers = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-password');
}

function authCheck(req, res) {
  const pwd = req.headers['x-password'];
  if (pwd !== CRM_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function getLeads() {
  const r = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sorts: [{ timestamp: 'created_time', direction: 'descending' }] })
  });
  const data = await r.json();
  return data.results.map(page => ({
    id: page.id,
    name:      page.properties.Name?.title?.[0]?.plain_text || '',
    email:     page.properties.Email?.email || '',
    platform:  page.properties.Platform?.select?.name || '',
    message:   page.properties.Message?.rich_text?.[0]?.plain_text || '',
    status:    page.properties.Status?.select?.name || 'New',
    source:    page.properties.Source?.rich_text?.[0]?.plain_text || '',
    submitted: page.properties['Submitted At']?.date?.start || page.created_time,
    notes:     page.properties.Notes?.rich_text?.[0]?.plain_text || ''
  }));
}

async function addLead(body) {
  const { name, email, platform, message, source, timestamp } = body;
  return fetch(`https://api.notion.com/v1/pages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { database_id: NOTION_DB_ID },
      properties: {
        Name:           { title: [{ text: { content: name || 'Unknown' } }] },
        Email:          { email: email || null },
        Platform:       { select: { name: platform || 'Other' } },
        Message:        { rich_text: [{ text: { content: message || '' } }] },
        Source:         { rich_text: [{ text: { content: source || 'Website Form' } }] },
        Status:         { select: { name: 'New' } },
        'Submitted At': { date: { start: timestamp || new Date().toISOString() } }
      }
    })
  });
}

async function updateLead(id, body) {
  const props = {};
  if (body.status) props.Status = { select: { name: body.status } };
  if (body.notes !== undefined) props.Notes = { rich_text: [{ text: { content: body.notes } }] };
  return fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ properties: props })
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — add lead (Make.com calls this, no password needed but validate secret)
  if (req.method === 'POST') {
    const secret = req.headers['x-secret'] || req.body?.secret;
    if (secret !== CRM_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    try {
      await addLead(req.body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — fetch all leads (CRM page calls this)
  if (req.method === 'GET') {
    if (!authCheck(req, res)) return;
    try {
      const leads = await getLeads();
      return res.status(200).json(leads);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH — update lead status/notes
  if (req.method === 'PATCH') {
    if (!authCheck(req, res)) return;
    const { id, ...body } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      await updateLead(id, body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
