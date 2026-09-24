# Backend Foundation

Real .NET 10 solution with API, Core and Infrastructure projects. Build from repository root:

```powershell
npm run restore:backend
npm run build:backend
npm run dev:api
```

GET http://localhost:5017/health returns a read-only response. Authentication, EF Core/SQL schema, group/lesson logic, object storage and AI integrations are **not implemented yet**. No hidden seed or business write is performed at startup.
