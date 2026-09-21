const axios = require('axios');
const crypto = require('crypto');
const prisma = require('../lib/prisma');

const SUMSUB_APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SUMSUB_SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const SUMSUB_BASE_URL = 'https://api.sumsub.com';

function createSignature(timestamp, method, url) {
    const signature = crypto.createHmac('sha256', SUMSUB_SECRET_KEY);
    signature.update(timestamp + method + url);
    return signature.digest('hex');
}

async function fetchApplicantData(applicantId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const method = 'GET';
    const url = `/resources/applicants/${applicantId}/one`;

    const response = await axios({
        method,
        url: `${SUMSUB_BASE_URL}${url}`,
        headers: {
            'Accept': 'application/json',
            'X-App-Token': SUMSUB_APP_TOKEN,
            'X-App-Access-Sig': createSignature(timestamp, method, url),
            'X-App-Access-Ts': timestamp
        }
    });

    return response.data;
}

async function syncKycDataToUser(userId, applicantId, reviewResult) {
    const applicantData = await fetchApplicantData(applicantId);
    const info = applicantData.info || {};
    const isApproved = reviewResult?.reviewAnswer === 'GREEN';
    const status = isApproved ? 'VERIFIED' : 'REJECTED';
    const rejectionNote = reviewResult?.moderationComment || reviewResult?.clientComment || null;

    const updatedUser = await prisma.user.update({
        where: { id: Number(userId) },
        data: {
            kyc_status: status,
            kyc_applicant_id: applicantId,
            kyc_rejection_note: rejectionNote,
            kyc_verified_at: isApproved ? new Date() : null,
            phone_number: info.phone || undefined,
            first_name: info.firstName || undefined,
            last_name: info.lastName || undefined,
            date_of_birth: info.dob ? new Date(info.dob) : undefined
        }
    });

    if (applicantData.idDocs && Array.isArray(applicantData.idDocs)) {
        for (const doc of applicantData.idDocs) {
            let docType = 'NATIONAL_ID';
            if (doc.idDocType === 'PASSPORT') docType = 'PASSPORT';
            if (doc.idDocType === 'DRIVERS') docType = 'DRIVERS_LICENSE';
            if (doc.idDocType === 'SELFIE') docType = 'SELFIE_LIVENESS';

            const fileUrl = doc.imageIds?.length > 0
                ? `${SUMSUB_BASE_URL}/resources/inspects/${applicantId}/images/${doc.imageIds[0]}`
                : "MOCK_STORAGE_URL";

            await prisma.kycDocument.create({
                data: {
                    user_id: Number(userId),
                    doc_type: docType,
                    file_url: fileUrl,
                    id_number: doc.number || null,
                    country: doc.country || null,
                    is_face_match: docType === 'SELFIE_LIVENESS' ? isApproved : true,
                    ocr_raw_data: doc
                }
            });
        }
    }

    return updatedUser;
}

module.exports = { syncKycDataToUser };