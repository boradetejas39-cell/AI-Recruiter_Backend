const mongoose = require('mongoose');

/**
 * Job Schema - Job Description Management
 * Stores job postings and their requirements for AI matching
 */
const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Job title is required'],
    trim: true,
    maxlength: [200, 'Job title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Job description is required'],
    trim: true,
    maxlength: [5000, 'Job description cannot exceed 5000 characters']
  },
  requiredSkills: {
    type: [String],
    required: [true, 'Required skills are needed'],
    validate: {
      validator: function (skills) {
        return skills.length > 0;
      },
      message: 'At least one required skill must be specified'
    }
  },
  experienceRequired: {
    min: {
      type: Number,
      min: 0,
      default: 0
    },
    max: {
      type: Number,
      min: 0,
      default: 0
    },
    experienceType: {
      type: String,
      enum: ['years', 'months'],
      default: 'years'
    }
  },
  location: {
    type: String,
    required: [true, 'Location is required'],
    trim: true,
    maxlength: [200, 'Location cannot exceed 200 characters']
  },
  jobType: {
    type: String,
    enum: ['full-time', 'part-time', 'contract', 'internship', 'remote'],
    default: 'full-time'
  },
  salary: {
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
  department: {
    type: String,
    trim: true,
    maxlength: [100, 'Department cannot exceed 100 characters']
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'closed'],
    default: 'active'
  },
  statusChangeReason: {
    type: String,
    trim: true
  },
  statusChangedAt: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Job creator is required']
  },
  applicants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resume'
  }],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
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
jobSchema.index({ title: 'text', description: 'text' });
jobSchema.index({ status: 1, createdAt: -1 });
jobSchema.index({ createdBy: 1 });
jobSchema.index({ requiredSkills: 1 });
jobSchema.index({ location: 1 });

// Virtual for applicant count
jobSchema.virtual('applicantCount').get(function () {
  return this.applicants ? this.applicants.length : 0;
});

// Virtual for experience range display
jobSchema.virtual('experienceRange').get(function () {
  const exp = this.experienceRequired;
  if (exp.min === 0 && exp.max === 0) return 'No experience required';
  if (exp.min === exp.max) return `${exp.min} ${exp.experienceType}`;
  return `${exp.min}-${exp.max} ${exp.experienceType}`;
});

// Pre-save middleware to process skills
jobSchema.pre('save', function (next) {
  if (this.requiredSkills) {
    // Clean and normalize skills
    this.requiredSkills = this.requiredSkills
      .map(skill => skill.trim().toLowerCase())
      .filter(skill => skill.length > 0)
      .filter((skill, index, self) => self.indexOf(skill) === index); // Remove duplicates
  }

  if (this.tags) {
    this.tags = this.tags
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);
  }

  next();
});

// Static method to find active jobs
jobSchema.statics.findActiveJobs = function () {
  return this.find({ status: 'active' }).sort({ createdAt: -1 });
};

// Static method to search jobs
jobSchema.statics.searchJobs = function (query, filters = {}) {
  const searchQuery = {
    status: 'active',
    ...filters
  };

  if (query) {
    searchQuery.$text = { $search: query };
  }

  return this.find(searchQuery)
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });
};

// Instance method to add applicant
jobSchema.methods.addApplicant = function (resumeId) {
  if (!this.applicants.includes(resumeId)) {
    this.applicants.push(resumeId);
  }
  return this.save();
};

// Instance method to remove applicant
jobSchema.methods.removeApplicant = function (resumeId) {
  this.applicants = this.applicants.filter(id => !id.equals(resumeId));
  return this.save();
};

module.exports = mongoose.model('Job', jobSchema);
