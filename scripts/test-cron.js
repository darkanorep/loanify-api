const prisma = require("../src/lib/prisma");
const { runDailyLoanJobs } = require("../src/services/cron.service");

async function setupAndRunTest() {
    console.log("🧪 Setting up cron test conditions...");

    // 1. Fetch an active loan
    const activeLoan = await prisma.loan.findFirst({
        where: { status: "ACTIVE" },
        include: { user: true, installments: { where: { status: "PENDING" } } }
    });

    if (!activeLoan) {
        console.log("❌ No active loans found to test. Create an active loan first.");
        return;
    }

    const testInstallment = activeLoan.installments[0];
    if (!testInstallment) {
        console.log("❌ No pending installments found for Loan #", activeLoan.id);
        return;
    }

    // 2. Enable AutoPay for the borrower
    await prisma.user.update({
        where: { id: activeLoan.user_id },
        data: { autopay_enabled: true }
    });

    // 3. Move installment due date back to yesterday so it triggers AutoPay/Overdue logic
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.installment.update({
        where: { id: testInstallment.id },
        data: { due_date: yesterday }
    });

    console.log(`✅ Set Installment #${testInstallment.id} due date to yesterday (${yesterday.toDateString()}).`);

    // 4. Execute Cron Job directly
    console.log("🚀 Executing runDailyLoanJobs()...");
    await runDailyLoanJobs();

    // 5. Inspect Results
    const updatedInst = await prisma.installment.findUnique({
        where: { id: testInstallment.id }
    });

    const updatedUser = await prisma.user.findUnique({
        where: { id: activeLoan.user_id }
    });

    console.log("\n📊 --- TEST RESULTS ---");
    console.log("Installment Status:", updatedInst.status);
    console.log("Amount Paid:", updatedInst.amount_paid);
    console.log("Borrower Credit Score:", updatedUser.credit_score);
    console.log("------------------------\n");

    process.exit(0);
}

setupAndRunTest().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});