const mongoose = require('mongoose');

/**
 * Match Schema - AI Matching Results Storage
 * Stores matching scores and breakdowns between jobs and resumes
 */
const matchSchema = new mongoose.Schema({
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: [true, 'Job ID is required']
  },
  resumeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resume',
    required: [true, 'Resume ID is required']
  },
  score: {
    type: Number,
    required: [true, 'Match score is required'],
    min: 0,
    max: 100
  },
  breakdown: {
    skillMatch: {
      score: {
        type: Number,
        required: true,
        min: 0,
        max: 100
      },
      matchedSkills: [{
        skill: {
          type: String,
          required: true
        },
        weight: {
          type: Number,
          default: 1
        }
      }],
      missingSkills: [{
        skill: {
          type: String,
          required: true
        },
        weight: {
          type: Number,
          default: 1
        }
      }],
      totalRequired: {
        type: Number,
        required: true
      },
      totalMatched: {
        type: Number,
        required: true
      }
    },
    experienceMatch: {
      score: {
        type: Number,
        required: true,
        min: 0,
        max: 100
      },
      requiredYears: {
        type: Number,
        required: true
      },
      candidateYears: {
        type: Number,
        required: true
      },
      meetsRequirement: {
        type: Boolean,
        required: true
      }
    },
    educationMatch: {
      score: {
        type: Number,
        required: true,
        min: 0,
        max: 100
      },
      highestDegree: {
        type: String
      },
      fieldRelevance: {
        type: Number,
        min: 0,
        max: 100
      }
    },
    locationMatch: {
      score: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      jobLocation: {
        type: String
      },
      candidateLocation: {
        type: String
      },
      isRemote: {
        type: Boolean,
        default: false
      }
    }
  },
  algorithm: {
    version: {
      type: String,
      default: '1.0'
    },
    weights: {
      skills: {
        type: Number,
        default: 0.6
      },
      experience: {
        type: Number,
        default: 0.3
      },
      education: {
        type: Number,
        default: 0.1
      }
    }
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'shortlisted', 'rejected', 'hired'],
    default: 'pending'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: {
    type: Date
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  tags: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index for unique job-resume combinations
matchSchema.index({ jobId: 1, resumeId: 1 }, { unique: true });

// Indexes for performance
matchSchema.index({ jobId: 1, score: -1 });
matchSchema.index({ resumeId: 1, score: -1 });
matchSchema.index({ status: 1, createdAt: -1 });
matchSchema.index({ reviewedBy: 1 });

// Virtual for match quality
matchSchema.virtual('quality').get(function() {
  if (this.score >= 80) return 'excellent';
  if (this.score >= 60) return 'good';
  if (this.score >= 40) return 'fair';
  return 'poor';
});

// Virtual for recommendation level
matchSchema.virtual('recommendation').get(function() {
  if (this.score >= 85) return 'Highly Recommended';
  if (this.score >= 70) return 'Recommended';
  if (this.score >= 50) return 'Consider';
  return 'Not Recommended';
});

// Pre-save middleware to validate score breakdown
matchSchema.pre('save', function(next) {
  // Validate that the weighted score matches the calculated score
  const weights = this.algorithm.weights;
  const calculatedScore = Math.round(
    (this.breakdown.skillMatch.score * weights.skills) +
    (this.breakdown.experienceMatch.score * weights.experience) +
    (this.breakdown.educationMatch.score * weights.education)
  );
  
  // Allow small rounding differences
  if (Math.abs(this.score - calculatedScore) > 2) {
    this.score = calculatedScore;
  }
  
  // Clean tags
  if (this.tags) {
    this.tags = this.tags
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);
  }
  
  next();
});

// Static method to find matches for a job
matchSchema.statics.findByJob = function(jobId, options = {}) {
  const query = { jobId };
  
  if (options.status) {
    query.status = options.status;
  }
  
  if (options.minScore) {
    query.score = { $gte: options.minScore };
  }
  
  return this.find(query)
    .populate('resumeId', 'candidateName email skills experience education')
    .populate('jobId', 'title location requiredSkills')
    .sort({ score: -1, createdAt: -1 });
};

// Static method to find matches for a resume
matchSchema.statics.findByResume = function(resumeId, options = {}) {
  const query = { resumeId };
  
  if (options.status) {
    query.status = options.status;
  }
  
  if (options.minScore) {
    query.score = { $gte: options.minScore };
  }
  
  return this.find(query)
    .populate('jobId', 'title location requiredSkills')
    .populate('resumeId', 'candidateName email')
    .sort({ score: -1, createdAt: -1 });
};

// Static method to get top matches
matchSchema.statics.getTopMatches = function(jobId, limit = 10) {
  return this.find({ jobId })
    .populate('resumeId', 'candidateName email skills experience education')
    .populate('jobId', 'title location requiredSkills')
    .sort({ score: -1 })
    .limit(limit);
};

// Static method to get matching statistics
matchSchema.statics.getMatchStats = function(jobId) {
  return this.aggregate([
    { $match: { jobId: mongoose.Types.ObjectId(jobId) } },
    {
      $group: {
        _id: null,
        totalMatches: { $sum: 1 },
        averageScore: { $avg: '$score' },
        highMatches: {
          $sum: { $cond: [{ $gte: ['$score', 80] }, 1, 0] }
        },
        mediumMatches: {
          $sum: { $cond: [{ $and: [{ $gte: ['$score', 50] }, { $lt: ['$score', 80] }] }, 1, 0] }
        },
        lowMatches: {
          $sum: { $cond: [{ $lt: ['$score', 50] }, 1, 0] }
        }
      }
    }
  ]);
};

// Instance method to update status
matchSchema.methods.updateStatus = function(status, reviewedBy, notes) {
  this.status = status;
  this.reviewedBy = reviewedBy;
  this.reviewedAt = new Date();
  
  if (notes) {
    this.notes = notes;
  }
  
  return this.save();
};

// Instance method to add tag
matchSchema.methods.addTag = function(tag) {
  const normalizedTag = tag.trim().toLowerCase();
  if (!this.tags.includes(normalizedTag)) {
    this.tags.push(normalizedTag);
  }
  return this.save();
};

module.exports = mongoose.model('Match', matchSchema);
