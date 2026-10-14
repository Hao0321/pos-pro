param([Parameter(Mandatory=$true)][string]$OutputDirectory,[Parameter(Mandatory=$true)][string]$LanAddress)
$ErrorActionPreference='Stop'
$ip=[System.Net.IPAddress]::Parse($LanAddress)
if($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork){throw 'IPv4 required'}
if(-not $env:POS_TLS_PASSWORD){throw 'Certificate password required'}
[System.IO.Directory]::CreateDirectory($OutputDirectory)|Out-Null
$rsa=[System.Security.Cryptography.RSA]::Create(2048)
try {
  $request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=POS Pro Store', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $san.AddIpAddress($ip)
  $request.CertificateExtensions.Add($san.Build())
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign),$true))
  $oids=[System.Security.Cryptography.OidCollection]::new()
  $oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))|Out-Null
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$false))
  $cert=$request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddYears(1))
  try {
    [System.IO.File]::WriteAllBytes([System.IO.Path]::Combine($OutputDirectory,'store.pfx'),$cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$env:POS_TLS_PASSWORD))
    [System.IO.File]::WriteAllBytes([System.IO.Path]::Combine($OutputDirectory,'store.cer'),$cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  }finally{$cert.Dispose()}
}finally{$rsa.Dispose()}
