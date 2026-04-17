/**
 * Job Status Service
 * Automatically updates job statuses based on time criteria
 */

const Job = require('../models/Job');

class JobStatusService {
  constructor() {
    // Define status transition rules (in days)
    this.statusRules = {
      // After 30 days, change from active to closed
      'active': {
        nextStatus: 'closed',
        daysThreshold: 30,
        reason: 'Job posting expired after 30 days'
      },
      // After 7 days, change from active to inactive (optional)
      'active_to_inactive': {
        nextStatus: 'inactive',
        daysThreshold: 7,
        reason: 'Job marked inactive after 7 days without activity'
      }
    };
  }

  /**
   * Check and update job statuses based on creation date
   */
  async updateJobStatuses() {
    try {
      console.log('🔄 Starting automatic job status updates...');

      if (global.fileDB) {
        // File-based database
        const jobs = global.fileDB.read('jobs');
        const updatedJobs = [];
        let updatedCount = 0;

        jobs.forEach(job => {
          const jobAge = this.calculateJobAge(job.createdAt);
          const originalStatus = job.status;
          let newStatus = originalStatus;

          // Check if job should be updated
          if (originalStatus === 'active' && jobAge > this.statusRules.active.daysThreshold) {
            newStatus = this.statusRules.active.nextStatus;
            updatedCount++;
            console.log(`📋 Job "${job.title}" status changed: ${originalStatus} → ${newStatus} (${this.statusRules.active.reason})`);
          }

          // Only update if status actually changed
          if (newStatus !== originalStatus) {
            updatedJobs.push({
              ...job,
              status: newStatus,
              updatedAt: new Date().toISOString(),
              statusChangeReason: this.statusRules.active.reason,
              statusChangedAt: new Date().toISOString()
            });
          } else {
            updatedJobs.push(job);
          }
        });

        // Save updated jobs
        if (updatedCount > 0) {
          global.fileDB.write('jobs', updatedJobs);
          console.log(`✅ Updated ${updatedCount} job statuses automatically`);
        } else {
          console.log('ℹ️ No job status updates needed');
        }

        return {
          success: true,
          updatedCount,
          totalJobs: jobs.length
        };
      } else {
        // MongoDB implementation
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.statusRules.active.daysThreshold);

        const result = await Job.updateMany(
          { status: 'active', createdAt: { $lt: cutoffDate } },
          {
            $set: {
              status: 'closed',
              updatedAt: new Date(),
              statusChangeReason: this.statusRules.active.reason,
              statusChangedAt: new Date()
            }
          }
        );

        const updatedCount = result.modifiedCount;
        if (updatedCount > 0) {
          console.log(`✅ Updated ${updatedCount} job statuses automatically (MongoDB)`);
        } else {
          console.log('ℹ️ No job status updates needed');
        }

        return {
          success: true,
          updatedCount,
          totalJobs: await Job.countDocuments()
        };
      }
    } catch (error) {
      console.error('❌ Error updating job statuses:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate the age of a job in days
   */
  calculateJobAge(createdAt) {
    const createdDate = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now - createdDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Get status of a specific job
   */
  getJobStatus(job) {
    const jobAge = this.calculateJobAge(job.createdAt);

    if (job.status === 'active' && jobAge > this.statusRules.active.daysThreshold) {
      return {
        currentStatus: 'closed',
        shouldUpdate: true,
        reason: this.statusRules.active.reason,
        age: jobAge
      };
    }

    return {
      currentStatus: job.status,
      shouldUpdate: false,
      age: jobAge
    };
  }

  /**
   * Manually update a specific job status
   */
  async updateJobStatus(jobId, newStatus, reason = 'Manual update') {
    try {
      if (global.fileDB) {
        const jobs = global.fileDB.read('jobs');
        const jobIndex = jobs.findIndex(job => job._id === jobId);

        if (jobIndex === -1) {
          return { success: false, message: 'Job not found' };
        }

        const oldStatus = jobs[jobIndex].status;
        jobs[jobIndex] = {
          ...jobs[jobIndex],
          status: newStatus,
          updatedAt: new Date().toISOString(),
          statusChangeReason: reason,
          statusChangedAt: new Date().toISOString()
        };

        global.fileDB.write('jobs', jobs);

        console.log(`📋 Job "${jobs[jobIndex].title}" status manually updated: ${oldStatus} → ${newStatus} (${reason})`);

        return {
          success: true,
          job: jobs[jobIndex],
          oldStatus,
          newStatus
        };
      } else {
        // MongoDB implementation
        const job = await Job.findById(jobId);
        if (!job) {
          return { success: false, message: 'Job not found' };
        }

        const oldStatus = job.status;
        job.status = newStatus;
        job.updatedAt = new Date();
        job.statusChangeReason = reason;
        job.statusChangedAt = new Date();
        await job.save();

        console.log(`📋 Job "${job.title}" status manually updated: ${oldStatus} → ${newStatus} (${reason})`);

        return { success: true, job, oldStatus, newStatus };
      }
    } catch (error) {
      console.error('❌ Error updating job status:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new JobStatusService();
