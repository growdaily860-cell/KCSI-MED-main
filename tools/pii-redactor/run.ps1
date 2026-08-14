[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InputPath,

    [Parameter(Mandatory)]
    [string]$OutputPath,

    [ValidatePattern('^\d{1,3},\d{1,3},\d{1,3}$')]
    [string]$Fill = '0,0,0',

    [string[]]$Entities,

    [switch]$NoHeuristics
)

$ErrorActionPreference = 'Stop'
$toolRoot = $PSScriptRoot
$venvPython = Join-Path $toolRoot '.venv\Scripts\python.exe'
$redactor = Join-Path $toolRoot 'redact_pii_image.py'

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw 'The local environment is missing. Run setup.ps1 first.'
}
if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Input file not found: $InputPath"
}

$arguments = @($redactor, $InputPath, $OutputPath, '--fill', $Fill)
if ($Entities) {
    $arguments += '--entities'
    $arguments += $Entities
}
if ($NoHeuristics) {
    $arguments += '--no-heuristics'
}

& $venvPython @arguments
