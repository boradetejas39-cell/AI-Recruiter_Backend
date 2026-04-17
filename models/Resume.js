const mongoose = require('mongoose');

/**
 * Resume Schema - Candidate Resume Management
 * Stores parsed resume data and extracted information for AI matching
 */
const resumeSchema = new mongoose.Schema({
  candidateName: {
    type: String,
    required: [true, 'Candidate name is required'],
    trim: true,
    maxlength: [200, 'Candidate name cannot exceed 200 characters']
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
  },
  skills: {
    type: [String],
    default: []
  },
  experience: [{
    company: {
      type: String,
      trim: true,
      default: ''
    },
    position: {
      type: String,
      trim: true,
      default: ''
    },
    startDate: {
      type: Date,
      default: null
    },
    endDate: {
      type: Date,
      default: null
    },
    description: {
      type: String,
      trim: true
    },
    location: {
      type: String,
      trim: true
    }
  }],
  education: [{
    institution: {
      type: String,
      trim: true,
      default: ''
    },
    degree: {
      type: String,
      trim: true,
      default: ''
    },
    field: {
      type: String,
      trim: true
    },
    startDate: {
      type: Date,
      default: null
    },
    endDate: {
      type: Date,
      default: null
    },
    year: {
      type: String,
      trim: true
    },
    gpa: {
      type: Number,
      min: 0,
      max: 10.0
    }
  }],
  rawText: {
    type: String,
    required: [true, 'Raw resume text is required']
  },
  fileName: {
    type: String,
    required: [true, 'Original filename is required']
  },
  filePath: {
    type: String,
    required: [true, 'File path is required']
  },
  fileType: {
    type: String,
    enum: ['pdf', 'docx'],
    required: true
  },
  uploadedBy: {
    type: String,
    required: [true, 'Uploader information is required']
  },
  totalExperience: {
    type: Number, // in years
    default: 0
  },
  currentLocation: {
    type: String,
    trim: true
  },
  preferredLocation: {
    type: String,
    trim: true
  },
  expectedSalary: {
    min: {
      type: Number,
      min: 0
    },
    max: {
      type: Number,
      min: 0
    },
    currency: {
      type: String,
      default: 'USD'
    }
  },
  availability: {
    type: String,
    enum: ['immediately', '2-weeks', '1-month', '2-months', '3-months'],
    default: '2-weeks'
  },
  status: {
    type: String,
    enum: ['new', 'active', 'inactive', 'hired', 'rejected'],
    default: 'new'
  },
  source: {
    type: String,
    enum: ['upload', 'email', 'linkedin', 'indeed', 'referral', 'other'],
    default: 'upload'
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

// Indexes for better query performance
resumeSchema.index({ email: 1 });
resumeSchema.index({ skills: 1 });
resumeSchema.index({ status: 1, createdAt: -1 });
resumeSchema.index({ uploadedBy: 1 });
resumeSchema.index({ candidateName: 'text', rawText: 'text' });

// Virtual for total years of experience
resumeSchema.virtual('totalYearsExperience').get(function () {
  return this.totalExperience || 0;
});

// Virtual for current position
resumeSchema.virtual('currentPosition').get(function () {
  const currentJob = this.experience.find(exp => !exp.endDate);
  return currentJob ? currentJob.position : null;
});

// Virtual for current company
resumeSchema.virtual('currentCompany').get(function () {
  const currentJob = this.experience.find(exp => !exp.endDate);
  return currentJob ? currentJob.company : null;
});

// Virtual for highest education
resumeSchema.virtual('highestEducation').get(function () {
  if (!this.education || this.education.length === 0) return null;

  const educationLevels = {
    'phd': 4,
    'master': 3,
    'bachelor': 2,
    'associate': 1,
    'diploma': 0.5,
    'certificate': 0.25
  };

  let highest = this.education[0];
  let highestScore = 0;

  this.education.forEach(edu => {
    const degree = edu.degree.toLowerCase();
    let score = 0;

    for (const [level, levelScore] of Object.entries(educationLevels)) {
      if (degree.includes(level)) {
        score = levelScore;
        break;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      highest = edu;
    }
  });

  return highest;
});

// Pre-save middleware to process skills and calculate experience
resumeSchema.pre('save', function (next) {
  // Clean and normalize skills
  if (this.skills) {
    this.skills = this.skills
      .map(skill => skill.trim().toLowerCase())
      .filter(skill => skill.length > 0)
      .filter((skill, index, self) => self.indexOf(skill) === index); // Remove duplicates
  }

  // Clean tags
  if (this.tags) {
    this.tags = this.tags
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);
  }

  // Calculate total experience
  this.totalExperience = this.calculateTotalExperience();

  next();
});

// Instance method to calculate total experience
resumeSchema.methods.calculateTotalExperience = function () {
  if (!this.experience || this.experience.length === 0) return 0;

  let totalMonths = 0;

  this.experience.forEach(exp => {
    const start = new Date(exp.startDate);
    const end = exp.endDate ? new Date(exp.endDate) : new Date();

    const months = (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    totalMonths += Math.max(0, months);
  });

  return Math.round((totalMonths / 12) * 10) / 10; // Round to 1 decimal place
};

// Static method to find active resumes
resumeSchema.statics.findActiveResumes = function () {
  return this.find({ status: 'active' }).sort({ createdAt: -1 });
};

// Static method to search resumes by skills
resumeSchema.statics.findBySkills = function (requiredSkills, minMatch = 1) {
  return this.find({
    status: 'active',
    skills: { $in: requiredSkills }
  }).sort({ createdAt: -1 });
};

// Static method to search resumes
resumeSchema.statics.searchResumes = function (query, filters = {}) {
  const searchQuery = {
    status: 'active',
    ...filters
  };

  if (query) {
    searchQuery.$text = { $search: query };
  }

  return this.find(searchQuery)
    .sort({ createdAt: -1 });
};

// Instance method to add skill
resumeSchema.methods.addSkill = function (skill) {
  const normalizedSkill = skill.trim().toLowerCase();
  if (!this.skills.includes(normalizedSkill)) {
    this.skills.push(normalizedSkill);
  }
  return this.save();
};

// Instance method to remove skill
resumeSchema.methods.removeSkill = function (skill) {
  const normalizedSkill = skill.trim().toLowerCase();
  this.skills = this.skills.filter(s => s !== normalizedSkill);
  return this.save();
};

module.exports = mongoose.model('Resume', resumeSchema);
