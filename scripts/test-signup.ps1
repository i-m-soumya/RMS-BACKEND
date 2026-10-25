param(
  [string]$ApiBase = "http://localhost:3000/api",
  [string]$OwnerName = "Signup Test",
  [string]$RestaurantName = "Signup Test Kitchen",
  [string]$Email = ""
)

$ErrorActionPreference = "Stop"
if (-not $Email) {
  $Email = Read-Host "Enter an email inbox you can access"
}
$Mobile = Read-Host "Enter an unused 10-digit Indian mobile number"
$StartBody = @{
  ownerName = $OwnerName
  restaurantName = $RestaurantName
  email = $Email
  mobile = $Mobile
  consent = $true
  policyVersion = "2026-10"
  utm = @{}
  referrer = "manual-powershell-test"
  hp = ""
} | ConvertTo-Json -Depth 4

$Plan = Invoke-RestMethod "$ApiBase/signup/plan"
$Signup = Invoke-RestMethod "$ApiBase/signup/start" -Method Post -ContentType "application/json" -Body $StartBody
$Token = $Signup.token
Write-Host "Signup created. Current step: $($Signup.step)"

Invoke-RestMethod "$ApiBase/signup/$Token/email-otp/send" -Method Post -ContentType "application/json" -Body "{}" | Out-Null
$EmailCode = Read-Host "Enter the email OTP"
Invoke-RestMethod "$ApiBase/signup/$Token/email-otp/verify" -Method Post -ContentType "application/json" -Body (@{ code = $EmailCode } | ConvertTo-Json) | Out-Null

Invoke-RestMethod "$ApiBase/signup/$Token/mobile-otp/send" -Method Post -ContentType "application/json" -Body "{}" | Out-Null
Write-Host "Dummy mobile mode uses 0000."
Invoke-RestMethod "$ApiBase/signup/$Token/mobile-otp/verify" -Method Post -ContentType "application/json" -Body (@{ code = "0000" } | ConvertTo-Json) | Out-Null

$Password = Read-Host "Choose a password (minimum 8 characters)"
Invoke-RestMethod "$ApiBase/signup/$Token/password" -Method Post -ContentType "application/json" -Body (@{ password = $Password } | ConvertTo-Json) | Out-Null

$ConfirmBody = @{
  autopayConsent = $true
  idempotencyKey = [guid]::NewGuid().ToString()
  simulate = "success"
} | ConvertTo-Json
$Result = Invoke-RestMethod "$ApiBase/signup/$Token/trial/confirm" -Method Post -ContentType "application/json" -Body $ConfirmBody
Write-Host "Trial ends: $($Result.trialEnd)"
Write-Host "Continue in console: $($Result.redirectUrl)"
