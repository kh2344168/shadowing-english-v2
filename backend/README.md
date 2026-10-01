# V2 Backend

.NET 10 modular monolith: API, Core and Infrastructure. Existing source includes Identity authentication, Admin management, Groups, published curricula, Shadowing authoring and Student progress. Other feature modules remain outside the implemented Shadowing scope.

From the V2 root:

```powershell
npm run restore:backend
npm run build:backend
npm run dev:api
```

Configure `ConnectionStrings__DefaultConnection` privately for an explicitly identified V2 database. Migrations, account provisioning and Development fixtures are separate explicit actions; startup and GET do not seed business data. Never point test commands at V1 or the user's ordinary V2 database.

Development audio is local by default. Hosted final WAVs use private Azure Blob Storage behind `IShadowingMediaStore`; see [storage setup](../docs/RUNBOOKS/AZURE_SHADOWING_MEDIA_AR.md). Unconfigured Production authoring returns 503. The lesson-processing engine and models stay on the administrator's computer.

The isolated acceptance suite runs the real API/Identity/CSRF against disposable SQLite and loopback Azurite, without live SQL/Azure or user credentials:

```powershell
npm install --prefix .local/media-tools --no-audit --no-fund azurite@3.35.0
py -3.12 tests/run_media_checks.py
```

See [current results and environment limits](../docs/RUNBOOKS/MEDIA_STORAGE_TEST_REPORT_2026-09-30.md) and [authoring flow](../docs/RUNBOOKS/SHADOWING_AUTHORING_SLICE.md). No container provisioning, automatic schema migration, hosted AI or student recording upload is performed by this change.
