const natural = require('natural');
const logger = require('../utils/logger');

/**
 * AI Interview Service
 * Generates role-specific interview questions, evaluates answers,
 * computes per-question and overall scores, and produces feedback.
 */

class AIInterviewService {
    constructor() {
        this.tokenizer = new natural.WordTokenizer();
        this.stemmer = natural.PorterStemmer;

        // ── Question bank organised by category ────────────────────
        this.questionBank = {
            aptitude: [
                { text: 'If 5 machines take 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?', options: ['100 minutes', '5 minutes', '50 minutes', '1 minute'], correctAnswer: '5 minutes', difficulty: 'medium', type: 'mcq' },
                { text: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?', options: ['$0.10', '$0.05', '$1.00', '$0.01'], correctAnswer: '$0.05', difficulty: 'medium', type: 'mcq' },
                { text: 'Which number should come next in the pattern: 2, 4, 8, 16, 32, ...?', options: ['48', '64', '128', '40'], correctAnswer: '64', difficulty: 'easy', type: 'mcq' },
                { text: 'What is 15% of 80?', options: ['10', '12', '15', '20'], correctAnswer: '12', difficulty: 'easy', type: 'mcq' },
                { text: 'If a train travels 60 miles in 1.5 hours, what is its average speed?', options: ['40 mph', '45 mph', '60 mph', '90 mph'], correctAnswer: '40 mph', difficulty: 'easy', type: 'mcq' },
                { text: 'What is the next prime number after 31?', options: ['33', '35', '37', '39'], correctAnswer: '37', difficulty: 'medium', type: 'mcq' },
                { text: 'A shirt originally costs $40. It is on sale for 20% off. What is the sale price?', options: ['$30', '$32', '$34', '$38'], correctAnswer: '$32', difficulty: 'easy', type: 'mcq' },
                { text: 'If 3x + 7 = 22, what is x?', options: ['3', '4', '5', '6'], correctAnswer: '5', difficulty: 'easy', type: 'mcq' },
                { text: 'Which word does not belong?', options: ['Apple', 'Banana', 'Carrot', 'Orange'], correctAnswer: 'Carrot', difficulty: 'easy', type: 'mcq' },
                { text: 'Solve: 8 + 2 * (5 - 3)', options: ['12', '16', '20', '10'], correctAnswer: '12', difficulty: 'medium', type: 'mcq' },
                { text: 'What is the square root of 144?', options: ['10', '12', '14', '16'], correctAnswer: '12', difficulty: 'easy', type: 'mcq' },
                { text: 'If a rectangle has a length of 10 and width of 4, what is the perimeter?', options: ['28', '40', '14', '24'], correctAnswer: '28', difficulty: 'easy', type: 'mcq' },
                { text: 'A clock shows 3:15. What is the angle between the hour and minute hands?', options: ['0 degrees', '7.5 degrees', '15 degrees', '22.5 degrees'], correctAnswer: '7.5 degrees', difficulty: 'hard', type: 'mcq' },
                { text: 'In a class of 30 students, 12 play soccer, 14 play basketball, and 6 play both. How many play neither?', options: ['4', '10', '8', '6'], correctAnswer: '10', difficulty: 'hard', type: 'mcq' },
                { text: 'What is the missing number in the sequence: 1, 1, 2, 3, 5, 8, ?', options: ['10', '11', '12', '13'], correctAnswer: '13', difficulty: 'easy', type: 'mcq' },
                { text: 'What comes next: Z, Y, X, W, ...?', options: ['U', 'V', 'T', 'S'], correctAnswer: 'V', difficulty: 'easy', type: 'mcq' },
                { text: 'If John is taller than Mary, and Mary is taller than Sue, who is the shortest?', options: ['John', 'Mary', 'Sue', 'Cannot be determined'], correctAnswer: 'Sue', difficulty: 'easy', type: 'mcq' },
                { text: 'A worker makes $15/hr. If they work 40 hours a week for 4 weeks, what is their gross pay?', options: ['$2,400', '$2,000', '$1,800', '$2,500'], correctAnswer: '$2,400', difficulty: 'medium', type: 'mcq' },
                { text: 'If "CAR" is coded as 3118, how is "DOG" coded?', options: ['4157', '4147', '3157', '4167'], correctAnswer: '4157', difficulty: 'hard', type: 'mcq' },
                { text: 'Which of the following is equivalent to 3/4?', options: ['0.60', '0.70', '0.75', '0.80'], correctAnswer: '0.75', difficulty: 'easy', type: 'mcq' },
                { text: 'What is 10 cubed?', options: ['100', '1,000', '10,000', '100,000'], correctAnswer: '1,000', difficulty: 'easy', type: 'mcq' },
                { text: 'How many degrees are in a triangle?', options: ['90', '180', '270', '360'], correctAnswer: '180', difficulty: 'easy', type: 'mcq' },
                { text: 'If x = 2 and y = 3, what is x^y?', options: ['5', '6', '8', '9'], correctAnswer: '8', difficulty: 'medium', type: 'mcq' },
                { text: 'Which fraction is the largest?', options: ['1/2', '3/4', '2/3', '5/8'], correctAnswer: '3/4', difficulty: 'medium', type: 'mcq' },
                { text: 'A box contains 5 red, 3 blue, and 2 green balls. What is the probability of pulling a blue ball?', options: ['1/2', '3/10', '1/3', '3/8'], correctAnswer: '3/10', difficulty: 'medium', type: 'mcq' },
                { text: 'What is the least common multiple (LCM) of 6 and 8?', options: ['12', '18', '24', '48'], correctAnswer: '24', difficulty: 'medium', type: 'mcq' },
                { text: 'If 2/x = 4/10, what is x?', options: ['3', '4', '5', '6'], correctAnswer: '5', difficulty: 'medium', type: 'mcq' },
                { text: 'What is the sum of the first 10 positive integers?', options: ['45', '50', '55', '60'], correctAnswer: '55', difficulty: 'medium', type: 'mcq' },
                { text: 'A car depreciates by 10% each year. If it is bought for $20,000, what is it worth after 2 years?', options: ['$18,000', '$16,000', '$16,200', '$16,400'], correctAnswer: '$16,200', difficulty: 'hard', type: 'mcq' },
                { text: 'If 20 workers can build a wall in 5 days, how many workers are needed to build it in 2 days?', options: ['40', '50', '60', '25'], correctAnswer: '50', difficulty: 'hard', type: 'mcq' },
                { text: 'What is the next number in the series: 1, 4, 9, 16, 25, ?', options: ['30', '32', '36', '40'], correctAnswer: '36', difficulty: 'easy', type: 'mcq' },
                { text: 'A pizza is sliced into 8 pieces. If you eat 3 pieces, what percentage of the pizza is remaining?', options: ['37.5%', '50%', '62.5%', '70%'], correctAnswer: '62.5%', difficulty: 'medium', type: 'mcq' }
            ],
            technical: [
                { text: 'Explain the difference between REST and GraphQL APIs.', options: ['REST is faster than GraphQL', 'GraphQL allows fetching multiple resources in a single request', 'REST uses schemas, GraphQL does not', 'There is no difference'], correctAnswer: 'GraphQL allows fetching multiple resources in a single request', difficulty: 'medium', type: 'mcq' },
                { text: 'What is the time complexity of binary search?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n^2)'], correctAnswer: 'O(log n)', difficulty: 'medium', type: 'mcq' },
                { text: 'Describe the concept of middleware in web frameworks.', options: ['It handles direct database storage', 'It intercepts and processes requests before they reach the route handler', 'It serves purely static frontend assets', 'It acts as the CSS processing engine'], correctAnswer: 'It intercepts and processes requests before they reach the route handler', difficulty: 'easy', type: 'mcq' },
                { text: 'What is the primary difference between SQL and NoSQL databases?', options: ['NoSQL databases rely heavily on strict table schemas', 'SQL databases cannot scale horizontally as easily as NoSQL', 'SQL databases do not support primary keys', 'NoSQL is strictly for numbers'], correctAnswer: 'SQL databases cannot scale horizontally as easily as NoSQL', difficulty: 'easy', type: 'mcq' },
                { text: 'Which HTTP method is idempotent and typically used for updates?', options: ['POST', 'GET', 'PUT', 'DELETE'], correctAnswer: 'PUT', difficulty: 'easy', type: 'mcq' },
                { text: 'What is a closure in JavaScript?', options: ['A function inside another function that retains access to the outer function\'s scope', 'A method to close browser tabs', 'A memory leak prevention mechanism', 'A synchronous loop feature'], correctAnswer: 'A function inside another function that retains access to the outer function\'s scope', difficulty: 'medium', type: 'mcq' },
                { text: 'Which data structure follows the LIFO principle?', options: ['Queue', 'Tree', 'Stack', 'Linked List'], correctAnswer: 'Stack', difficulty: 'easy', type: 'mcq' },
                { text: 'What is the virtual DOM in React?', options: ['A lightweight copy of the real DOM kept in memory', 'A secondary browser window', 'A database mirror', 'A completely deprecated feature in React 18'], correctAnswer: 'A lightweight copy of the real DOM kept in memory', difficulty: 'medium', type: 'mcq' },
                { text: 'Which of the following is NOT an OOP principle?', options: ['Encapsulation', 'Polymorphism', 'Inheritance', 'Compilation'], correctAnswer: 'Compilation', difficulty: 'easy', type: 'mcq' },
                { text: 'What does CSS stand for?', options: ['Cascading Style Sheets', 'Core Style Scripts', 'Computer Styling System', 'Cascading Script Sheets'], correctAnswer: 'Cascading Style Sheets', difficulty: 'easy', type: 'mcq' },
                { text: 'How do you prevent a form from submitting naturally in React?', options: ['form.pause()', 'e.preventDefault()', 'event.stop()', 'return false'], correctAnswer: 'e.preventDefault()', difficulty: 'easy', type: 'mcq' },
                { text: 'What is Webpack primarily used for?', options: ['Database management', 'Module bundling', 'Container orchestration', 'Cloud hosting'], correctAnswer: 'Module bundling', difficulty: 'medium', type: 'mcq' },
                { text: 'Which framework is maintained by Google?', options: ['React', 'Angular', 'Vue', 'Svelte'], correctAnswer: 'Angular', difficulty: 'easy', type: 'mcq' },
                { text: 'In Git, how do you save your changes temporarily without committing?', options: ['git hold', 'git stash', 'git pause', 'git push'], correctAnswer: 'git stash', difficulty: 'medium', type: 'mcq' },
                { text: 'What is Node.js?', options: ['A frontend UI library', 'A JavaScript runtime built on Chrome\'s V8 engine', 'A relational database', 'An operating system'], correctAnswer: 'A JavaScript runtime built on Chrome\'s V8 engine', difficulty: 'easy', type: 'mcq' },
                { text: 'What is the main purpose of Docker?', options: ['Writing Python code', 'Creating isolated containers for applications', 'Version control tracking', 'Managing DNS configurations'], correctAnswer: 'Creating isolated containers for applications', difficulty: 'medium', type: 'mcq' },
                { text: 'Which algorithm is typically used for finding the shortest path in a graph?', options: ['Merge Sort', 'Binary Search', 'Dijkstra\'s Algorithm', 'Quick Sort'], correctAnswer: 'Dijkstra\'s Algorithm', difficulty: 'hard', type: 'mcq' },
                { text: 'What is a JSON Web Token (JWT) used for?', options: ['Rendering images natively', 'Stateless user authentication', 'Compressing video files', 'Caching database queries'], correctAnswer: 'Stateless user authentication', difficulty: 'medium', type: 'mcq' },
                { text: 'What does API stand for?', options: ['Automated Program Interface', 'Application Programming Interface', 'Asynchronous Processing Integration', 'Authorized Public Interface'], correctAnswer: 'Application Programming Interface', difficulty: 'easy', type: 'mcq' },
                { text: 'Which SQL command is used to combine rows from multiple tables?', options: ['MERGE', 'UNION', 'JOIN', 'AGGREGATE'], correctAnswer: 'JOIN', difficulty: 'easy', type: 'mcq' },
                { text: 'What is CORS?', options: ['Cross-Origin Resource Sharing', 'Computer Operating Routing System', 'Compiled Output Render System', 'Cascading Object Registry Store'], correctAnswer: 'Cross-Origin Resource Sharing', difficulty: 'medium', type: 'mcq' },
                { text: 'What does ACID stand for in databases?', options: ['Atomicity, Consistency, Isolation, Durability', 'Array, Cache, Interface, Data', 'Application, Core, Input, Directory', 'Asynchronous, Constant, Iterative, Dynamic'], correctAnswer: 'Atomicity, Consistency, Isolation, Durability', difficulty: 'hard', type: 'mcq' },
                { text: 'Which of the following is a dynamically typed language?', options: ['Java', 'C++', 'Python', 'C#'], correctAnswer: 'Python', difficulty: 'easy', type: 'mcq' },
                { text: 'In JavaScript, what does `===` mean?', options: ['Assignment', 'Loose equality', 'Strict equality', 'Bitwise comparison'], correctAnswer: 'Strict equality', difficulty: 'easy', type: 'mcq' },
                { text: 'What is the time complexity of pushing to a standard stack?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n^2)'], correctAnswer: 'O(1)', difficulty: 'medium', type: 'mcq' },
                { text: 'How do you create a new branch in Git?', options: ['git branch <name>', 'git new <name>', 'git create <name>', 'git spawn <name>'], correctAnswer: 'git branch <name>', difficulty: 'easy', type: 'mcq' },
                { text: 'What is an IIFE in JavaScript?', options: ['Immediately Invoked Function Expression', 'Internal Interface Formatting Engine', 'Integrated Iterative Fetch Error', 'Indexed Iterable Function Event'], correctAnswer: 'Immediately Invoked Function Expression', difficulty: 'hard', type: 'mcq' },
                { text: 'Which of the following creates a block-scoped variable in JS?', options: ['var', 'let', 'function', 'global'], correctAnswer: 'let', difficulty: 'easy', type: 'mcq' },
                { text: 'What does MVC stand for?', options: ['Module View Code', 'Model View Controller', 'Memory Variable Cache', 'Method Value Component'], correctAnswer: 'Model View Controller', difficulty: 'easy', type: 'mcq' },
                { text: 'What is a Promise in JavaScript?', options: ['A guarantee that code will run', 'An object representing the eventual completion of an async operation', 'A strict typing mechanism', 'A built-in database driver'], correctAnswer: 'An object representing the eventual completion of an async operation', difficulty: 'medium', type: 'mcq' },
                { text: 'Which status code indicates a successful HTTP request?', options: ['200', '404', '500', '302'], correctAnswer: '200', difficulty: 'easy', type: 'mcq' },
                { text: 'What does semantic HTML mean?', options: ['Using tags that describe the meaning of their content', 'Writing HTML with strict indentations', 'Using only divs and spans', 'Avoiding CSS styles inline'], correctAnswer: 'Using tags that describe the meaning of their content', difficulty: 'medium', type: 'mcq' },
                { text: 'What is Babel primarily used for in the JS ecosystem?', options: ['Compiling C++ to JavaScript', 'Transpiling modern JavaScript into backwards-compatible versions', 'Linting code for errors', 'Minifying CSS'], correctAnswer: 'Transpiling modern JavaScript into backwards-compatible versions', difficulty: 'hard', type: 'mcq' },
                { text: 'Which CSS property handles text color?', options: ['text-color', 'font-color', 'color', 'background-color'], correctAnswer: 'color', difficulty: 'easy', type: 'mcq' },
                { text: 'What is the role of a Load Balancer?', options: ['Storing files permanently', 'Distributing incoming network traffic across multiple servers', 'Compiling code before execution', 'Encrypting database passwords'], correctAnswer: 'Distributing incoming network traffic across multiple servers', difficulty: 'medium', type: 'mcq' },
                { text: 'What is CI/CD?', options: ['Component Integration / Code Deployment', 'Continuous Integration / Continuous Deployment', 'Client Interface / Cloud Domain', 'Central Initialization / Core Data'], correctAnswer: 'Continuous Integration / Continuous Deployment', difficulty: 'medium', type: 'mcq' },
                { text: 'Which data structure is best for searching exact matches extremely fast?', options: ['Array', 'Linked List', 'Hash Table / Dictionary', 'Binary Tree'], correctAnswer: 'Hash Table / Dictionary', difficulty: 'medium', type: 'mcq' }
            ],
            hr: [
                { text: 'Why do you want to work for this company specifically?', keywords: ['vision', 'mission', 'culture', 'growth', 'opportunity', 'align'], difficulty: 'easy', type: 'text' },
                { text: 'Where do you see yourself in 5 years?', keywords: ['growth', 'career', 'learning', 'contribution', 'leadership', 'expert'], difficulty: 'medium', type: 'text' },
                { text: 'What are your salary expectations for this role?', keywords: ['competitive', 'range', 'negotiable', 'market', 'value'], difficulty: 'medium', type: 'text' },
                { text: 'Describe your ideal work environment.', keywords: ['collaborative', 'autonomous', 'flexible', 'supportive', 'remote', 'hybrid'], difficulty: 'easy', type: 'text' },
                { text: 'What motivates you to perform your best at work?', keywords: ['challenge', 'impact', 'recognition', 'learning', 'purpose', 'team'], difficulty: 'medium', type: 'text' }
            ],
            behavioral: [
                { text: 'Tell me about a time you had to meet a tight deadline.', keywords: ['deadline', 'prioritize', 'time', 'manage', 'deliver', 'pressure'], difficulty: 'easy', type: 'text' },
                { text: 'How do you handle disagreements with team members?', keywords: ['conflict', 'communicate', 'listen', 'compromise', 'team', 'resolve'], difficulty: 'easy', type: 'text' }
            ],
            situational: [
                { text: 'If you found a critical bug in production on a Friday evening, what would you do?', keywords: ['bug', 'production', 'communicate', 'fix', 'rollback', 'team', 'priority'], difficulty: 'medium', type: 'text' },
                { text: 'How would you onboard yourself into a large, unfamiliar codebase?', keywords: ['documentation', 'code', 'read', 'ask', 'understand', 'architecture', 'mentor'], difficulty: 'medium', type: 'text' }
            ],
            role_specific: [] // Dynamically generated based on job skills
        };
    }

    /**
     * Generate interview questions tailored to a job and round.
     */
    generateQuestions(job, resume, round = 'aptitude', count = 5) {
        const questions = [];
        const skills = (job.requiredSkills || []).map(s => s.toLowerCase());

        if (round === 'aptitude') {
            const shuffled = [...this.questionBank.aptitude].sort(() => Math.random() - 0.5);
            for (let i = 0; i < count && i < shuffled.length; i++) {
                questions.push({
                    text: shuffled[i].text,
                    options: shuffled[i].options,
                    correctAnswer: shuffled[i].correctAnswer,
                    type: 'mcq',
                    category: 'aptitude',
                    round: 'aptitude',
                    difficulty: shuffled[i].difficulty
                });
            }
        } else if (round === 'hr') {
            const shuffled = [...this.questionBank.hr].sort(() => Math.random() - 0.5);
            for (let i = 0; i < count && i < shuffled.length; i++) {
                questions.push({
                    text: shuffled[i].text,
                    type: 'text',
                    category: 'hr',
                    round: 'hr',
                    difficulty: shuffled[i].difficulty,
                    _expectedKeywords: shuffled[i].keywords
                });
            }
        } else {
            // Technical Round
            const roleCount = Math.ceil(count * 0.5);
            for (let i = 0; i < roleCount && i < skills.length; i++) {
                questions.push({
                    text: `Which of the following describes a key capability of ${skills[i]}?`,
                    options: [
                        `It is fundamentally deprecated and no longer used in modern systems.`,
                        `It facilitates robust and efficient logic execution in its primary domain.`,
                        `It is primarily a graphic design tool lacking programmable logic.`,
                        `It is purely a database querying syntax.`
                    ],
                    correctAnswer: `It facilitates robust and efficient logic execution in its primary domain.`,
                    type: 'mcq',
                    category: 'role_specific',
                    round: 'technical',
                    difficulty: 'medium'
                });
            }

            const techCount = count - questions.length;
            const shuffledTech = [...this.questionBank.technical].sort(() => Math.random() - 0.5);
            for (let i = 0; i < techCount && i < shuffledTech.length; i++) {
                questions.push({
                    text: shuffledTech[i].text,
                    options: shuffledTech[i].options,
                    correctAnswer: shuffledTech[i].correctAnswer,
                    type: 'mcq',
                    category: 'technical',
                    round: 'technical',
                    difficulty: shuffledTech[i].difficulty
                });
            }
        }

        // Re-index questions
        return questions.map((q, idx) => ({
            ...q,
            questionId: `q${idx + 1}`
        }));
    }

    /**
     * Evaluate a single answer against a question's expected keywords or correct MCQ option.
     */
    evaluateAnswer(answer, q) {
        if (!answer || answer.trim().length === 0) {
            return {
                score: 0,
                feedback: 'Answer is missing.',
                matchedKeywords: []
            };
        }

        if (q.type === 'mcq') {
            const isCorrect = answer.trim() === (q.correctAnswer || '').trim();
            return {
                score: isCorrect ? 100 : 0,
                feedback: isCorrect ? 'Correct!' : `Incorrect. The correct answer was: ${q.correctAnswer}`,
                matchedKeywords: []
            };
        }

        // Text evaluation
        if (answer.trim().length < 10) {
            return {
                score: 0,
                feedback: 'Answer is too short or empty. Please provide a detailed response.',
                matchedKeywords: []
            };
        }

        const expectedKeywords = q._expectedKeywords || [];
        const answerTokens = this.tokenizer
            .tokenize(answer.toLowerCase().replace(/[^\w\s]/g, ' '))
            .map(t => this.stemmer.stem(t));

        const expectedStems = expectedKeywords.map(k => this.stemmer.stem(k.toLowerCase()));
        const matchedKeywords = expectedKeywords.filter((kw, i) => answerTokens.includes(expectedStems[i]));

        const keywordScore = expectedStems.length > 0
            ? (matchedKeywords.length / expectedStems.length) * 60
            : 30;
        const lengthBonus = Math.min(20, (answer.split(/\s+/).length / 50) * 20);
        const coherenceBonus = answer.length > 100 ? 10 : answer.length > 50 ? 5 : 0;
        const detailBonus = /example|project|built|implemented|team|result/i.test(answer) ? 10 : 0;

        const score = Math.min(100, Math.round(keywordScore + lengthBonus + coherenceBonus + detailBonus));

        let feedback;
        if (score >= 80) feedback = 'Excellent answer. Demonstrates strong understanding and provides relevant detail.';
        else if (score >= 60) feedback = 'Good answer. Could be improved with more specific examples or technical depth.';
        else if (score >= 40) feedback = 'Adequate answer but lacks depth. Consider elaborating on key concepts.';
        else feedback = 'Needs improvement. Answer does not sufficiently address the question.';

        if (matchedKeywords.length < expectedKeywords.length && expectedKeywords.length > 0) {
            const missing = expectedKeywords.filter(k => !matchedKeywords.includes(k));
            feedback += ` Consider covering: ${missing.slice(0, 3).join(', ')}.`;
        }

        return { score, feedback, matchedKeywords };
    }

    /**
     * Evaluate an entire interview — all questions and answers.
     */
    evaluateInterview(questions) {
        const evaluations = [];
        let totalScore = 0;
        const strengths = [];
        const weaknesses = [];

        for (const q of questions) {
            const result = this.evaluateAnswer(q.answer || '', q);
            evaluations.push({
                questionId: q.questionId,
                score: result.score,
                feedback: result.feedback,
                keywords: result.matchedKeywords
            });
            totalScore += result.score;

            if (result.score >= 70) {
                strengths.push(`Strong answer on: "${q.text.substring(0, 60)}…"`);
            } else if (result.score < 40) {
                weaknesses.push(`Weak answer on: "${q.text.substring(0, 60)}…"`);
            }
        }

        const overallScore = questions.length > 0 ? Math.round(totalScore / questions.length) : 0;

        // Recommendation thresholds
        let recommendation;
        if (overallScore >= 80) recommendation = 'strong_hire';
        else if (overallScore >= 65) recommendation = 'hire';
        else if (overallScore >= 45) recommendation = 'maybe';
        else recommendation = 'reject';

        const feedbackSummary = `Candidate scored ${overallScore}% across ${questions.length} questions. ` +
            `${strengths.length} strong answer(s), ${weaknesses.length} weak answer(s). ` +
            `Recommendation: ${recommendation.replace('_', ' ')}.`;

        return {
            overallScore,
            feedbackSummary,
            strengths,
            weaknesses,
            recommendation,
            evaluations
        };
    }
}

module.exports = new AIInterviewService();
