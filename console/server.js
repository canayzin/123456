import express from 'express';
import { nanoid } from 'nanoid';

const app = express();
app.use(express.json());

const projects = [];

app.get('/api/projects', (_, res) => res.json(projects));
app.post('/api/projects', (req, res) => {
  const project = {
    id: nanoid(),
    name: req.body.name,
    apiKey: `nb_${nanoid(24)}`,
    createdAt: new Date().toISOString()
  };
  projects.push(project);
  res.status(201).json(project);
});

app.get('/', (_, res) => {
  res.send(`<!doctype html><html><body><h1>NovaBase Console (MVP)</h1>
  <input id='name' placeholder='Project name'/><button onclick='create()'>Create Project</button>
  <pre id='out'></pre>
  <script>
  async function refresh(){ const r=await fetch('/api/projects'); out.textContent=JSON.stringify(await r.json(),null,2)}
  async function create(){await fetch('/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name.value})});refresh()}
  refresh();
  </script></body></html>`);
});

app.listen(4000, '0.0.0.0', () => console.log('console on 4000'));
