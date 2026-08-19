function otpEmailTemplate(otp) {
    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Loanify OTP Code</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f1ea; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1ea; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden;">

          <!-- Logo mark -->
          <tr>
            <td align="center" style="padding: 40px 24px 24px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#1b2a41; border-radius:16px; width:64px; height:64px;">
                <tr>
                  <td align="center" valign="bottom" style="height:64px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 0 2px 12px 2px; vertical-align:bottom;">
                          <div style="width:8px; height:16px; background-color:#ffffff; border-radius:2px;"></div>
                        </td>
                        <td style="padding: 0 2px 12px 2px; vertical-align:bottom;">
                          <div style="width:8px; height:24px; background-color:#ffffff; border-radius:2px;"></div>
                        </td>
                        <td style="padding: 0 2px 12px 2px; vertical-align:bottom;">
                          <div style="width:8px; height:32px; background-color:#e8663f; border-radius:2px;"></div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td align="center" style="padding: 0 24px;">
              <h1 style="margin:0; font-size:26px; line-height:32px; color:#1b2a41; font-weight:700;">
                Verify Your Identity
              </h1>
            </td>
          </tr>

          <!-- Code box -->
          <tr>
            <td align="center" style="padding: 28px 24px 8px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e8663f; border-radius:12px; background-color:#f4f1ea;">
                <tr>
                  <td align="center" style="padding: 20px;">
                    <span style="font-size:36px; font-weight:700; letter-spacing:6px; color:#1b2a41;">
                      ${otp}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Expiry -->
          <tr>
            <td align="center" style="padding: 12px 24px 0 24px;">
              <p style="margin:0; font-size:13px; color:#8a8578;">
                This code expires in 10 minutes
              </p>
            </td>
          </tr>

          <!-- Disclaimer -->
          <tr>
            <td align="center" style="padding: 24px 32px 0 32px;">
              <p style="margin:0; font-size:13px; line-height:20px; color:#6b6b6b; text-align:center;">
                If you didn't request this, please ignore this email or contact support.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 32px 24px 40px 24px;">
              <p style="margin:0; font-size:14px; font-weight:700; color:#1b2a41;">
                Loan<span style="color:#e8663f;">ify</span>
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px;">
                <a href="#" style="color:#8a8578; text-decoration:none; margin: 0 6px;">Facebook</a>
                &middot;
                <a href="#" style="color:#8a8578; text-decoration:none; margin: 0 6px;">Twitter</a>
                &middot;
                <a href="#" style="color:#8a8578; text-decoration:none; margin: 0 6px;">LinkedIn</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

module.exports = { otpEmailTemplate };