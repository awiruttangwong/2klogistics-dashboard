$ErrorActionPreference = "Stop"
$csvPath = "C:\Users\ADMIN\Desktop\Data sum Daily express 4 month V2.2\data\merged\merged_all_months.csv"
$outputPath = "C:\Users\ADMIN\Desktop\Data sum Daily express 4 month V2.2\dashboard\fraud_data.js"

Write-Host "Reading CSV file..."
$rawData = Get-Content $csvPath | Select-Object -Skip 2 | ConvertFrom-Csv

Write-Host "Calculating Route Benchmarks..."
$routeStats = @{}

foreach ($row in $rawData) {
    if ($row.customer -match "FLASH") {
        $row.customer = "FASH"
    }
    
    # We group by route_name and month
    $key = "$($row.route_name)_$($row.month)"
    
    if (-not $routeStats.ContainsKey($key)) {
        $routeStats[$key] = @{
            count = 0; sumPay = 0; sumOil = 0; sumPct = 0;
            payees = @{}
        }
    }

    $pay = 0; $oil = 0; $pct = 0
    if ([double]::TryParse($row.price_pay_thb, [ref]$pay)) {}
    if ([double]::TryParse($row.oil_advance_thb, [ref]$oil)) {}
    if ([double]::TryParse($row.profit_pct, [ref]$pct)) {}

    $routeStats[$key].count++
    $routeStats[$key].sumPay += $pay
    $routeStats[$key].sumOil += $oil
    $routeStats[$key].sumPct += $pct

    $payee = $row.contractor
    if (![string]::IsNullOrWhiteSpace($payee)) {
        if (-not $routeStats[$key].payees.ContainsKey($payee)) {
            $routeStats[$key].payees[$payee] = 0
        }
        $routeStats[$key].payees[$payee]++
    }
}

foreach ($k in $routeStats.Keys) {
    $s = $routeStats[$k]
    if ($s.count -gt 0) {
        $s.avgPay = $s.sumPay / $s.count
        $s.avgOil = $s.sumOil / $s.count
        $s.avgPct = $s.sumPct / $s.count
    }
}

$fraudRecords = @()
Write-Host "Detecting Anomalies in $($rawData.Count) records..."

foreach ($row in $rawData) {
    if ($row.customer -match "FLASH") {
        $row.customer = "FASH"
    }

    $key = "$($row.route_name)_$($row.month)"
    $s = $routeStats[$key]

    $recv = 0; $pay = 0; $oil = 0; $margin = 0; $pct = 0
    if ([double]::TryParse($row.price_receive_thb, [ref]$recv)) {}
    if ([double]::TryParse($row.price_pay_thb, [ref]$pay)) {}
    if ([double]::TryParse($row.oil_advance_thb, [ref]$oil)) {}
    if ([double]::TryParse($row.margin_thb, [ref]$margin)) {}
    if ([double]::TryParse($row.profit_pct, [ref]$pct)) {}

    $isFraud = $false
    $reasons = @()

    # Original Rules
    if ($pay -gt 0 -and $oil -gt ($pay * 0.5)) {
        $isFraud = $true
        $reasons += "HighOil"
    }
    if ($margin -lt 0) {
        $isFraud = $true
        $reasons += "Loss"
    }

    # New Benchmark Rules (only if route has at least 5 trips for stable average)
    if ($s.count -ge 5) {
        # Pay price is > 5% higher than peers
        if ($s.avgPay -gt 0 -and $pay -gt ($s.avgPay * 1.05)) {
            $isFraud = $true
            $reasons += "Overpaid"
        }
        # Oil is > 10% higher than peers
        if ($s.avgOil -gt 0 -and $oil -gt ($s.avgOil * 1.10)) {
            $isFraud = $true
            $reasons += "HighOilRoute"
        }
        # Profit % is 5 points lower than peers (e.g. 5% vs 10%)
        if ($pct -lt ($s.avgPct - 5)) {
            $isFraud = $true
            $reasons += "LowProfit"
        }
        # Payee is rare (< 15% of route trips)
        $payee = $row.contractor
        if (![string]::IsNullOrWhiteSpace($payee) -and $s.payees.ContainsKey($payee)) {
            $pCount = $s.payees[$payee]
            if (($pCount / $s.count) -lt 0.15) {
                $isFraud = $true
                $reasons += "WeirdPayee"
            }
        }
    }

    if ($isFraud) {
        $record = @{
            date = $row.date
            customer = $row.customer
            vtype = $row.vehicle_type
            route = $row.route_name
            routeDesc = $row.route_description
            driver = $row.driver_name
            plate = $row.plate_number
            payee = $row.contractor
            recv = $recv
            pay = $pay
            oil = $oil
            margin = $margin
            reason = ($reasons | Select-Object -Unique) -join ","
        }
        $fraudRecords += $record
    }
}

Write-Host "Found $($fraudRecords.Count) anomalous records."
$json = $fraudRecords | ConvertTo-Json -Depth 5 -Compress
$jsContent = "const FRAUD_DATA = $json;"
[System.IO.File]::WriteAllText($outputPath, $jsContent, [System.Text.Encoding]::UTF8)
Write-Host "Done! Saved to $outputPath"
