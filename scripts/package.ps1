[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$engineRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $engineRoot '.tmp/releases' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$metadata = Get-Content -LiteralPath (Join-Path $engineRoot 'package.json') -Raw | ConvertFrom-Json
if ($metadata.version -notmatch '^\d+\.\d+\.\d+$') { throw 'A release version is required.' }
$files = @(& git -C $engineRoot ls-files) | Where-Object {
    $_ -match '^(src/|scripts/|tests/|\.github/|README\.md$|LICENSE$|package(-lock)?\.json$|\.gitignore$|\.gitattributes$)'
}
if ($LASTEXITCODE -ne 0 -or $files.Count -lt 10) { throw 'Stage the complete source before packaging.' }
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$archive = Join-Path $OutputDirectory ('BontaFlowStack-engines-' + $metadata.version + '-source.zip')
if (Test-Path -LiteralPath $archive) { throw 'Choose a new output directory; existing release assets are preserved.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
$hashes = [ordered]@{}
try {
    foreach ($file in $files) {
        $source = Join-Path $engineRoot $file
        if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked source: $file" }
        $hashes[$file] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$source,$file,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    $entry = $zip.CreateEntry('release-manifest.json')
    $writer = [IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
    try { $writer.Write((@{schema=1;version=$metadata.version;commit=(& git -C $engineRoot rev-parse HEAD);dirty=[bool](& git -C $engineRoot status --porcelain);files=$hashes} | ConvertTo-Json -Depth 4)) } finally { $writer.Dispose() }
} finally { $zip.Dispose() }
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($archive + '.sha256',"$hash  $([IO.Path]::GetFileName($archive))`n",[Text.UTF8Encoding]::new($false))
@{archive=$archive;sha256=$hash;files=$files.Count} | ConvertTo-Json -Compress
