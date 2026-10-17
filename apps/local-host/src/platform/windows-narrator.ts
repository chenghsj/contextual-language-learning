import { z } from "zod";
import { SystemVoiceSchema, type SpeechInput } from "@contextual/core";
import type { SpeechRunner } from "./speech";

/**
 * NaturalVoiceSAPIAdapter exposes local Narrator tokens with NaturalVoiceType=Narrator;Local.
 * Check the token again on every playback, select by identity, and never use its cloud tokens.
 * No upstream binaries, voice packages, keys or registry changes are shipped by this backend.
 */
const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$synth = New-Object -ComObject SAPI.SpVoice
$file = $null
function Get-Attribute($token, [string]$name) {
  try { return [string]$token.GetAttribute($name) } catch { return '' }
}
try {
  $tokens = $synth.GetVoices()
  $voices = @()
  $selected = $null
  for ($index = 0; $index -lt $tokens.Count; $index++) {
    $token = $tokens.Item($index)
    if ((Get-Attribute $token 'NaturalVoiceType') -cne 'Narrator;Local') { continue }
    $id = 'narrator:' + [string]$token.Id
    $locale = Get-Attribute $token 'Locale'
    if ($locale -notmatch '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$') { continue }
    $voices += @{
      id = $id; name = [string]$token.GetDescription(); language = $locale
      engine = 'narrator'; neural = $true; installed = $true
    }
    if ($id -ceq [string]$inputData.voiceId) { $selected = $token }
  }
  if ($inputData.action -eq 'voices') {
    ConvertTo-Json -InputObject $voices -Compress
  } elseif ($inputData.action -eq 'speak' -or $inputData.action -eq 'render') {
    if ($null -eq $selected) { throw 'Local Narrator voice unavailable. Refresh voices.' }
    if ((Get-Attribute $selected 'Locale') -cne [string]$inputData.voiceLanguage) {
      throw 'Local Narrator voice language changed. Refresh voices.'
    }
    $synth.Voice = $selected
    $synth.Rate = [int]$inputData.rate
    if ($inputData.action -eq 'render') {
      $file = New-Object -ComObject SAPI.SpFileStream
      $file.Open([string]$inputData.outputPath, 3, $false)
      $synth.AudioOutputStream = $file
    }
    $segments = @(([string]$inputData.text).Split([char]0x2029) | Where-Object { $_.Trim().Length -gt 0 })
    for ($index = 0; $index -lt $segments.Count; $index++) {
      # Only this constant is XML (SVSFIsXML=8). Lesson text is always literal (SVSFIsNotXML=16).
      if ($index -gt 0) { [void]$synth.Speak('<silence msec="300"/>', 8) }
      [void]$synth.Speak([string]$segments[$index], 16)
    }
    if ($synth.Status.LastHResult -ne 0) { throw 'Local Narrator synthesis failed.' }
  } else { throw 'Unknown Narrator action.' }
} finally {
  if ($null -ne $file) {
    $file.Close()
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($file)
  }
  [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($synth)
}
`;

export const windowsNarratorArgs = [
  "-NoProfile",
  "-NonInteractive",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
];

const NarratorVoiceSchema = SystemVoiceSchema.extend({
  id: z.string().startsWith("narrator:").max(256),
  engine: z.literal("narrator"),
  neural: z.literal(true),
  installed: z.literal(true),
});

export class WindowsNarratorBackend {
  constructor(private run: SpeechRunner) {}

  async installed() {
    const output = await this.run(
      "powershell.exe",
      windowsNarratorArgs,
      JSON.stringify({ action: "voices" }),
      25_000,
    ).completion;
    return z
      .array(NarratorVoiceSchema)
      .max(1000)
      .parse(JSON.parse(output.replace(/^\uFEFF/, "")));
  }

  speak(input: SpeechInput, voiceLanguage: string) {
    return this.run(
      "powershell.exe",
      windowsNarratorArgs,
      JSON.stringify({
        action: "speak",
        voiceId: input.voiceId,
        voiceLanguage,
        rate: Math.max(-10, Math.min(10, Math.round(Math.log2(input.rate) * 5))),
        text: input.text,
      }),
    );
  }
}
