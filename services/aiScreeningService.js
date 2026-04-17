const natural = require('natural');
const logger = require('../utils/logger');

/**
 * AI Screening Service
 * Compares a candidate's resume against a job description and produces:
 *   • matchScore (0–100)
 *   • strengths / weaknesses lists
 *   • recommendation: hire | maybe | reject
 *   • narrative summary
 *
 * This extends the basic matching by adding strengths/weaknesses analysis
 * and actionable hiring recommendations.
 */

class AIScreeningService {
    constructor() {
        this.tokenizer = new natural.WordTokenizer();
        this.stemmer = natural.PorterStemmer;
        this.tfidf = new natural.TfIdf();
    }

    /**
     * Normalise and tokenise text for comparison
     */
    _normalise(text) {
        if (!text) return [];
        return this.tokenizer
            .tokenize(text.toLowerCase().replace(/[^\w\s]/g, ' '))
            .filter(t => t.length > 2)
            .map(t => this.stemmer.stem(t));
    }

    /**
     * Main screening method — compares resume data against a job object.
     *
     * @param {Object} job    Mongoose Job document (or lean object)
     * @param {Object} resume Mongoose Resume document (or lean object)
     * @returns {Object}      { matchScore, strengths, weaknesses, recommendation, summary }
     */
    async screenCandidate(job, resume) {
        try {
            // ── 1. Skill analysis ────────────────────────────────────
            const requiredSkills = (job.requiredSkills || [])
                .filter(s => typeof s === 'string')
                .map(s => s.toLowerCase().trim());
            const candidateSkills = (resume.skills || [])
                .filter(s => typeof s === 'string')
                .map(s => s.toLowerCase().trim());

            const matchedSkills = requiredSkills.filter(s =>
                candidateSkills.some(cs => cs === s || cs.includes(s) || s.includes(cs))
            );
            const missingSkills = requiredSkills.filter(s => !matchedSkills.includes(s));
            const extraSkills = candidateSkills.filter(s =>
                !requiredSkills.some(rs => rs === s || rs.includes(s) || s.includes(rs))
            );
            const skillScore = requiredSkills.length > 0
                ? (matchedSkills.length / requiredSkills.length) * 100
                : 50;

            // ── 2. Experience analysis ───────────────────────────────
            const requiredExp = Number(job.experienceRequired?.min) || 0;
            const candidateExp = Number(resume.totalExperience) || 0;
            let expScore = 100;
            if (requiredExp > 0) {
                expScore = Math.min(100, (candidateExp / requiredExp) * 100);
            }
            const meetsExperience = candidateExp >= requiredExp;

            // ── 3. Education relevance (keyword overlap with job desc) ─
            const educationText = (resume.education || [])
                .filter(e => e)
                .map(e => `${e.degree || ''} ${e.field || ''} ${e.institution || ''}`)
                .join(' ');
            const jobDescTokens = this._normalise(job.description || '');
            const eduTokens = this._normalise(educationText);
            const eduOverlap = eduTokens.filter(t => jobDescTokens.includes(t)).length;
            const eduScore = eduTokens.length > 0
                ? Math.min(100, (eduOverlap / Math.max(eduTokens.length, 1)) * 100)
                : 30;

            // ── 4. Weighted composite score ──────────────────────────
            const matchScore = Math.round(
                skillScore * 0.55 +
                expScore * 0.30 +
                eduScore * 0.15
            );

            // ── 5. Strengths & Weaknesses ────────────────────────────
            const strengths = [];
            const weaknesses = [];

            if (matchedSkills.length >= requiredSkills.length * 0.8) {
                strengths.push(`Strong skill coverage (${matchedSkills.length}/${requiredSkills.length} required skills matched)`);
            } else if (matchedSkills.length > 0) {
                strengths.push(`Partial skill match (${matchedSkills.length}/${requiredSkills.length} skills)`);
            }
            if (extraSkills.length > 0) {
                strengths.push(`Brings additional skills: ${extraSkills.slice(0, 5).join(', ')}`);
            }
            if (meetsExperience) {
                strengths.push(`Meets experience requirement (${candidateExp} ${job.experienceRequired?.experienceType || 'years'})`);
            }
            if (eduScore > 50) {
                strengths.push('Education aligns well with role');
            }

            if (missingSkills.length > 0) {
                weaknesses.push(`Missing required skills: ${missingSkills.join(', ')}`);
            }
            if (!meetsExperience && requiredExp > 0) {
                weaknesses.push(`Below experience requirement (has ${candidateExp}, needs ${requiredExp} ${job.experienceRequired?.experienceType || 'years'})`);
            }
            if (eduScore < 30) {
                weaknesses.push('Education has low relevance to the role');
            }
            if (candidateSkills.length === 0) {
                weaknesses.push('No skills extracted from resume');
            }

            // ── 6. Recommendation ────────────────────────────────────
            let recommendation;
            if (matchScore >= 75) {
                recommendation = 'hire';
            } else if (matchScore >= 50) {
                recommendation = 'maybe';
            } else {
                recommendation = 'reject';
            }

            // ── 7. Summary narrative ─────────────────────────────────
            const summary = this._generateSummary(
                resume.candidateName || 'Candidate',
                job.title,
                matchScore,
                matchedSkills,
                missingSkills,
                meetsExperience,
                recommendation
            );

            return {
                matchScore,
                strengths,
                weaknesses,
                recommendation,
                summary,
                details: {
                    skillScore: Math.round(skillScore),
                    expScore: Math.round(expScore),
                    eduScore: Math.round(eduScore),
                    matchedSkills,
                    missingSkills,
                    extraSkills: extraSkills.slice(0, 10),
                    candidateExperience: candidateExp,
                    requiredExperience: requiredExp
                }
            };
        } catch (error) {
            logger.error('AI Screening error', { error: error.message });
            throw error;
        }
    }

    /**
     * Generate human-readable summary
     */
    _generateSummary(name, jobTitle, score, matched, missing, meetsExp, rec) {
        const recText = { hire: 'Recommended for hire', maybe: 'Needs further evaluation', reject: 'Not recommended' };
        let text = `${name} scored ${score}% for the "${jobTitle}" position. `;
        text += `${matched.length} out of the required skills were matched. `;
        if (missing.length > 0) text += `Missing: ${missing.join(', ')}. `;
        text += meetsExp ? 'Experience requirement met. ' : 'Does not meet experience requirement. ';
        text += `Overall recommendation: ${recText[rec] || rec}.`;
        return text;
    }
}

module.exports = new AIScreeningService();
