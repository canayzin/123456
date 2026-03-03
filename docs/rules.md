# Security Rules DSL (MVP)

JSON tabanlı sade DSL:

```json
[
  {
    "path": "/todos",
    "auth": "required",
    "ownerField": "ownerId",
    "allow": true,
    "validation": {
      "title": { "required": true, "type": "string", "maxLength": 120 }
    }
  }
]
```

## Rule Test Runner
`POST /v1/projects/:pid/rules/test`

Request:
```json
{
  "tests": [
    {
      "name": "allow create",
      "request": {
        "path": "/todos/1",
        "method": "create",
        "auth": { "uid": "u1" },
        "data": { "title": "a", "ownerId": "u1" }
      },
      "expectAllow": true
    }
  ]
}
```
