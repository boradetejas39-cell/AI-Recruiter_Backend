const natural = require('natural');
const Resume = require('../models/Resume');
const Job = require('../models/Job');
const Match = require('../models/Match');

/**
 * AI Matching Service
 * Implements semantic analysis and intelligent candidate-job matching
 */

class AIMatchingService {
  constructor() {
    // Initialize NLP tools
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;

    // Common skill categories and their weights
    this.skillCategories = {
      'programming': {
        keywords: ['javascript', 'python', 'java', 'react', 'node', 'angular', 'vue', 'html', 'css', 'sql', 'mongodb', 'mysql'],
        weight: 1.2
      },
      'soft_skills': {
        keywords: ['communication', 'leadership', 'teamwork', 'problem-solving', 'critical thinking', 'creativity'],
        weight: 0.8
      },
      'technical': {
        keywords: ['aws', 'azure', 'docker', 'kubernetes', 'git', 'ci/cd', 'devops', 'microservices'],
        weight: 1.1
      },
      'business': {
        keywords: ['project management', 'agile', 'scrum', 'analytics', 'strategy', 'planning'],
        weight: 0.9
      }
    };

    // Common stopwords to filter out
    this.stopwords = new Set([
      'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
      'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself',
      'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom',
      'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
      'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at',
      'by', 'for', 'with', 'through', 'during', 'before', 'after', 'above', 'below',
      'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
      'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can',
      'will', 'just', 'don', 'should', 'now', 'd', 'll', 'm', 'o', 're', 've',
      'y', 'ain', 'aren', 'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven',
      'isn', 'ma', 'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren',
      'won', 'wouldn', 'experience', 'years', 'year', 'worked', 'responsible', 'developed',
      'managed', 'led', 'created', 'implemented', 'designed', 'maintained', 'improved'
    ]);
  }

  /**
   * Clean and normalize text
   */
  cleanText(text) {
    if (!text) return '';

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
  }

  /**
   * Tokenize and remove stopwords
   */
  tokenizeAndFilter(text) {
    const tokens = this.tokenizer.tokenize(text);
    return tokens
      .filter(token => !this.stopwords.has(token))
      .filter(token => token.length > 2) // Remove very short tokens
      .map(token => this.stemmer.stem(token));
  }

  /**
   * Extract skills from text using keyword matching
   */
  extractSkills(text) {
    const cleanedText = this.cleanText(text);
    const tokens = this.tokenizeAndFilter(cleanedText);
    const skills = new Set();

    // Extract skills based on categories
    Object.entries(this.skillCategories).forEach(([category, config]) => {
      config.keywords.forEach(keyword => {
        const keywordTokens = this.tokenizeAndFilter(keyword);
        const keywordStems = keywordTokens.map(token => this.stemmer.stem(token));

        // Check if all keyword stems are present in tokens
        const hasAllTokens = keywordStems.every(stem => tokens.includes(stem));
        if (hasAllTokens) {
          skills.add(keyword);
        }
      });
    });

    // Additional skill extraction based on common patterns
    const skillPatterns = [
      /\b(javascript|python|java|react|node|angular|vue|html|css|sql|mongodb|mysql|aws|azure|docker|kubernetes|git|ci\/cd|devops|microservices)\b/gi,
      /\b(project management|agile|scrum|analytics|strategy|planning|communication|leadership|teamwork|problem-solving|critical thinking|creativity)\b/gi
    ];

    skillPatterns.forEach(pattern => {
      const matches = cleanedText.match(pattern);
      if (matches) {
        matches.forEach(match => skills.add(match.toLowerCase()));
      }
    });

    return Array.from(skills);
  }

  /**
   * Calculate cosine similarity between two text vectors
   */
  calculateCosineSimilarity(text1, text2) {
    const tokens1 = this.tokenizeAndFilter(this.cleanText(text1));
    const tokens2 = this.tokenizeAndFilter(this.cleanText(text2));

    // Create word frequency vectors
    const allTokens = [...new Set([...tokens1, ...tokens2])];
    const vector1 = allTokens.map(token => tokens1.filter(t => t === token).length);
    const vector2 = allTokens.map(token => tokens2.filter(t => t === token).length);

    // Calculate dot product
    const dotProduct = vector1.reduce((sum, val, i) => sum + (val * vector2[i]), 0);

    // Calculate magnitudes
    const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + (val * val), 0));
    const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + (val * val), 0));

    // Avoid division by zero
    if (magnitude1 === 0 || magnitude2 === 0) return 0;

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Calculate skill match score
   */
  calculateSkillMatch(jobSkills, resumeSkills) {
    const normalizedJobSkills = jobSkills.map(skill => skill.toLowerCase().trim());
    const normalizedResumeSkills = resumeSkills.map(skill => skill.toLowerCase().trim());

    const matchedSkills = [];
    const missingSkills = [];
    let totalWeight = 0;
    let matchedWeight = 0;

    normalizedJobSkills.forEach(jobSkill => {
      // Find skill category and weight
      let skillWeight = 1;
      for (const [category, config] of Object.entries(this.skillCategories)) {
        if (config.keywords.some(keyword => jobSkill.includes(keyword) || keyword.includes(jobSkill))) {
          skillWeight = config.weight;
          break;
        }
      }

      totalWeight += skillWeight;

      // Check if skill is present in resume (direct match or partial)
      const isMatched = normalizedResumeSkills.some(resumeSkill =>
        resumeSkill === jobSkill ||
        resumeSkill.includes(jobSkill) ||
        jobSkill.includes(resumeSkill)
      );

      if (isMatched) {
        matchedSkills.push({ skill: jobSkill, weight: skillWeight });
        matchedWeight += skillWeight;
      } else {
        missingSkills.push({ skill: jobSkill, weight: skillWeight });
      }
    });

    const score = totalWeight > 0 ? (matchedWeight / totalWeight) * 100 : 0;

    return {
      score: Math.round(score),
      matchedSkills,
      missingSkills,
      totalRequired: normalizedJobSkills.length,
      totalMatched: matchedSkills.length
    };
  }

  /**
   * Calculate experience match score
   */
  calculateExperienceMatch(requiredExperience, candidateExperience) {
    const requiredYears = requiredExperience.min || 0;
    const candidateYears = candidateExperience || 0;

    let score = 0;
    let meetsRequirement = false;

    if (requiredYears === 0) {
      score = 100; // No experience required
      meetsRequirement = true;
    } else if (candidateYears >= requiredYears) {
      // Bonus for exceeding requirements
      const excess = candidateYears - requiredYears;
      const bonus = Math.min(excess * 5, 20); // Max 20% bonus
      score = Math.min(100, 80 + bonus);
      meetsRequirement = true;
    } else {
      // Partial score for meeting some requirements
      score = (candidateYears / requiredYears) * 80;
      meetsRequirement = false;
    }

    return {
      score: Math.round(score),
      requiredYears,
      candidateYears,
      meetsRequirement
    };
  }

  /**
   * Calculate education match score
   */
  calculateEducationMatch(jobDescription, candidateEducation) {
    if (!candidateEducation || candidateEducation.length === 0) {
      return {
        score: 0,
        highestDegree: null,
        fieldRelevance: 0
      };
    }

    // Get highest education
    const highestEducation = candidateEducation.reduce((highest, current) => {
      const degreeLevels = {
        'phd': 4,
        'doctorate': 4,
        'master': 3,
        'mba': 3,
        'bachelor': 2,
        'undergraduate': 2,
        'associate': 1,
        'diploma': 0.5,
        'certificate': 0.25
      };

      const currentLevel = this.getEducationLevel(current.degree);
      const highestLevel = this.getEducationLevel(highest.degree);

      return currentLevel > highestLevel ? current : highest;
    });

    // Calculate field relevance based on job description
    const jobText = this.cleanText(jobDescription);
    const educationText = this.cleanText(
      candidateEducation.map(edu => `${edu.degree} ${edu.field}`).join(' ')
    );

    const fieldRelevance = this.calculateCosineSimilarity(jobText, educationText) * 100;

    // Base score on education level
    let baseScore = 0;
    const highestDegree = highestEducation.degree.toLowerCase();

    if (highestDegree.includes('phd') || highestDegree.includes('doctorate')) {
      baseScore = 100;
    } else if (highestDegree.includes('master') || highestDegree.includes('mba')) {
      baseScore = 85;
    } else if (highestDegree.includes('bachelor') || highestDegree.includes('undergraduate')) {
      baseScore = 70;
    } else if (highestDegree.includes('associate')) {
      baseScore = 55;
    } else if (highestDegree.includes('diploma')) {
      baseScore = 40;
    } else {
      baseScore = 25;
    }

    // Combine base score with field relevance
    const finalScore = (baseScore * 0.7) + (fieldRelevance * 0.3);

    return {
      score: Math.round(finalScore),
      highestDegree: highestEducation.degree,
      fieldRelevance: Math.round(fieldRelevance)
    };
  }

  /**
   * Helper to get education level score
   */
  getEducationLevel(degree) {
    if (!degree) return 0;

    const degreeLevels = {
      'phd': 4,
      'doctorate': 4,
      'master': 3,
      'mba': 3,
      'bachelor': 2,
      'undergraduate': 2,
      'associate': 1,
      'diploma': 0.5,
      'certificate': 0.25
    };

    const degreeLower = degree.toLowerCase();
    for (const [level, score] of Object.entries(degreeLevels)) {
      if (degreeLower.includes(level)) {
        return score;
      }
    }

    return 0;
  }

  /**
   * Calculate location match score
   */
  calculateLocationMatch(jobLocation, candidateLocation, isRemote = false) {
    if (isRemote) {
      return {
        score: 100,
        jobLocation,
        candidateLocation,
        isRemote: true
      };
    }

    if (!jobLocation || !candidateLocation) {
      return {
        score: 50,
        jobLocation,
        candidateLocation,
        isRemote: false
      };
    }

    const jobLoc = this.cleanText(jobLocation);
    const candidateLoc = this.cleanText(candidateLocation);

    // Exact match
    if (jobLoc === candidateLoc) {
      return {
        score: 100,
        jobLocation,
        candidateLocation,
        isRemote: false
      };
    }

    // Partial match (same city, state, etc.)
    const jobTokens = this.tokenizeAndFilter(jobLoc);
    const candidateTokens = this.tokenizeAndFilter(candidateLoc);

    const commonTokens = jobTokens.filter(token => candidateTokens.includes(token));
    const similarity = commonTokens.length / Math.max(jobTokens.length, candidateTokens.length);

    const score = Math.round(similarity * 100);

    return {
      score,
      jobLocation,
      candidateLocation,
      isRemote: false
    };
  }

  /**
   * Main matching function - calculate overall match score
   */
  async calculateMatch(jobId, resumeId) {
    try {
      // Get job and resume data
      const job = await Job.findById(jobId);
      const resume = await Resume.findById(resumeId);

      if (!job || !resume) {
        throw new Error('Job or Resume not found');
      }

      // Calculate individual scores
      const skillMatch = this.calculateSkillMatch(job.requiredSkills, resume.skills);
      const experienceMatch = this.calculateExperienceMatch(
        job.experienceRequired,
        resume.totalExperience
      );
      const educationMatch = this.calculateEducationMatch(job.description, resume.education);
      const locationMatch = this.calculateLocationMatch(
        job.location,
        resume.currentLocation,
        job.jobType === 'remote' || (job.location && job.location.toLowerCase().includes('remote'))
      );

      // Calculate weighted final score
      const weights = {
        skills: 0.6,
        experience: 0.3,
        education: 0.1
      };

      const finalScore = Math.round(
        (skillMatch.score * weights.skills) +
        (experienceMatch.score * weights.experience) +
        (educationMatch.score * weights.education)
      );

      return {
        jobId,
        resumeId,
        score: finalScore,
        breakdown: {
          skillMatch,
          experienceMatch,
          educationMatch,
          locationMatch
        },
        algorithm: {
          version: '1.0',
          weights
        }
      };
    } catch (error) {
      console.error('Error calculating match:', error);
      throw error;
    }
  }

  /**
   * Match all resumes against a job
   */
  async matchAllResumesForJob(jobId) {
    try {
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      const resumes = await Resume.find({ status: 'active' });
      const matches = [];

      for (const resume of resumes) {
        const matchData = await this.calculateMatch(jobId, resume._id);

        // Save match to database
        const match = await Match.findOneAndUpdate(
          { jobId, resumeId: resume._id },
          matchData,
          { upsert: true, new: true }
        ).populate('resumeId', 'candidateName email skills');

        matches.push(match);
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score);

      return matches;
    } catch (error) {
      console.error('Error matching resumes for job:', error);
      throw error;
    }
  }

  /**
   * Get top matches for a job
   */
  async getTopMatches(jobId, limit = 10) {
    try {
      return await Match.getTopMatches(jobId, limit);
    } catch (error) {
      console.error('Error getting top matches:', error);
      throw error;
    }
  }
}

module.exports = new AIMatchingService();
