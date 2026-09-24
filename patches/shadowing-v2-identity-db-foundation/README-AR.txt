Shadowing English V2 - Identity + Database Foundation (step 1)

Source baseline: V2 Foundation v3.1 Program.cs; updated user state checked by apply.ps1.
Scope: TWO new files in Infrastructure, ONE replacement of original Program.cs, ONE NuGet package in Infrastructure.csproj.
No edits to frontend, postcss, appsettings, docs, or any other module.
No automatic seed, migration, or database write.

1) Extract this package anywhere, while keeping its apply.ps1 and payload folder together.
2) Open PowerShell IN YOUR V2 REPOSITORY ROOT.
3) Stop npm run dev:api (Ctrl+C) before building.
4) Run: & "FULL_PATH_TO_EXTRACTED_PACKAGE\apply.ps1"
5) Run: npm run build:backend
6) If build is successful, from repository root execute:
   dotnet ef migrations add InitialIdentity --project backend/ShadowingEnglish.Infrastructure --startup-project backend/ShadowingEnglish.Api --context ApplicationDbContext --output-dir Database/Migrations
7) Inspect the generated migration. Only after review run:
   dotnet ef database update --project backend/ShadowingEnglish.Infrastructure --startup-project backend/ShadowingEnglish.Api --context ApplicationDbContext

Known status: C# build and SQL migration have NOT been executed in this environment (dotnet unavailable).
This stage does NOT implement login endpoints, CSRF, or role bootstrap yet. Login is NOT done.
Never move development TrustServerCertificate=True setting to production.
