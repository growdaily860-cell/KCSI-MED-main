[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$toolRoot = $PSScriptRoot
$venvPython = Join-Path $toolRoot '.venv\Scripts\python.exe'

function Invoke-BasePython {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        & $pythonCommand.Source @Arguments
        return
    }

    $pyCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCommand) {
        & $pyCommand.Source -3.11 @Arguments
        return
    }

    $codexPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $codexPython) {
        & $codexPython @Arguments
        return
    }

    throw 'Python 3.10-3.13 was not found. Install Python and run setup.ps1 again.'
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    Invoke-BasePython -Arguments @('-m', 'venv', (Join-Path $toolRoot '.venv'))
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $toolRoot 'requirements.txt')
& $venvPython -m spacy download ko_core_news_sm

Write-Host 'Setup complete. Use run.ps1 to process a PNG from the private directory.'
