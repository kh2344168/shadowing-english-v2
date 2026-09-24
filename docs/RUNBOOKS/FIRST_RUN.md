# First Run Verification

From repository root:

```powershell
node --version
npm --version
dotnet --version
npm install
npm run build:frontend
npm run build:backend
npm run dev
```

Second terminal: `npm run dev:api`. Check `http://localhost:5017/health`.

Capture command outputs in the Build Progress tracker. Do not mark foundation DONE until builds and smoke checks pass.
