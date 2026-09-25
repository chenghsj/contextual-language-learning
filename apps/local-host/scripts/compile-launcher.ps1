param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = "Stop"
# System .NET Framework compiler, included with Windows PowerShell 5.1.
# Compile only the fixed launcher source shipped in the verified release ZIP.
Add-Type -Path $Source -OutputAssembly $Output -OutputType ConsoleApplication -ErrorAction Stop
if (!(Test-Path -LiteralPath $Output)) { throw "Launcher compilation did not produce an executable" }
