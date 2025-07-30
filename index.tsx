
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Type } from '@google/genai';

// --- TYPE DEFINITIONS ---
type ResumeAnalytics = {
    summary: string;
    extracted_skills: string[];
    years_of_experience: number;
    project_highlights: string[];
    resume_status: 'Updated' | 'Pending';
};

type TrainingRecord = {
    name: string;
    date: string;
};

type Meeting = {
    id: number;
    title: string;
    status: 'Attended' | 'Pending';
    notes?: string;
};

type Consultant = {
    id: number;
    name: string;
    password?: string;
    department: 'Technology' | 'Finance' | 'Healthcare' | 'Unassigned';
    status: 'On Bench' | 'In Project';
    resumeStatus: 'Updated' | 'Pending';
    meetings: Meeting[]; // New detailed attendance
    opportunities: {
        count: number;
        descriptions: string[];
    };
    trainingStatus: 'Not Started' | 'In Progress' | 'Completed';
    skills: string[];
    workflow: {
        resumeUpdated: boolean;
        attendanceReported: boolean;
        opportunitiesDocumented: boolean;
        trainingCompleted: boolean;
    };
    resumeAnalytics: ResumeAnalytics | null;
    trainingHistory: TrainingRecord[];
};

type LoggedInUser = { id: number | 'admin'; type: 'consultant' | 'admin' };

type AppState = {
    loggedInUser: LoggedInUser | null;
    currentLoginTab: 'login' | 'register';
    loginError: string | null;
    adminFilters: {
        name: string;
        skill: string;
        department: string;
        status: string;
    };
    isLoading: boolean;
    isSuggestingTraining: boolean;
    isAdminLoading: {
        attendance: { [consultantId: number]: boolean };
        department: boolean;
    };
    selectedFile: File | null;
    activeConsultantTab: 'resume' | 'attendance' | 'training' | 'opportunities';
    modal: {
        isOpen: boolean;
        title: string;
        content: string;
    };
    editingConsultantId: number | null; // For admin edit modal
};

// --- DATA MANAGEMENT ---
let consultants: Consultant[] = [];

function getInitialMeetings(): Meeting[] {
    return Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        title: `Weekly Sync - Week ${i + 1}`,
        status: 'Pending',
    }));
}

function saveConsultants() {
    localStorage.setItem('consultantsData', JSON.stringify(consultants));
}

function loadConsultants() {
    const data = localStorage.getItem('consultantsData');
    const loadedConsultants: any[] = data ? JSON.parse(data) : [];

    // Migration for older data structures
    consultants = loadedConsultants.map(c => {
        const migratedConsultant: any = { ...c };
        if (typeof migratedConsultant.opportunities === 'number' || migratedConsultant.opportunities === undefined) {
            migratedConsultant.opportunities = {
                count: migratedConsultant.opportunities || 0,
                descriptions: []
            };
        }
        if (!migratedConsultant.trainingHistory) {
            migratedConsultant.trainingHistory = [];
        }
        // Migration for attendance
        if (migratedConsultant.attendance && !migratedConsultant.meetings) {
            const total = migratedConsultant.attendance.total || 10;
            const completed = migratedConsultant.attendance.completed || 0;
            migratedConsultant.meetings = Array.from({ length: total }, (_, i) => ({
                id: i + 1,
                title: `Weekly Sync - Week ${i + 1}`,
                status: i < completed ? 'Attended' : 'Pending',
            }));
            delete migratedConsultant.attendance; // clean up old property
        } else if (!migratedConsultant.meetings) {
            migratedConsultant.meetings = getInitialMeetings();
        }
        return migratedConsultant;
    });
}

// --- APPLICATION STATE ---
const state: AppState = {
    loggedInUser: null,
    currentLoginTab: 'login',
    loginError: null,
    adminFilters: { name: '', skill: '', department: '', status: '' },
    isLoading: false,
    isSuggestingTraining: false,
    isAdminLoading: { attendance: {}, department: false },
    selectedFile: null,
    activeConsultantTab: 'resume',
    modal: { isOpen: false, title: '', content: '' },
    editingConsultantId: null,
};

// --- GEMINI API & PDF.js SETUP ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const pdfjsLib = (window as any).pdfjsLib;
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;
}

// --- DOM ELEMENTS ---
const appRoot = document.getElementById('app-root')!;

// --- RENDER FUNCTIONS ---
function render() {
    state.loginError = null;
    if (state.loggedInUser) {
        renderMainApp();
    } else {
        renderLoginPage();
    }
}

function renderMainApp() {
    const isConsultant = state.loggedInUser?.type === 'consultant';
    appRoot.innerHTML = `
        <div id="app-container">
            <header>
                <h1>Pool Consultant Management System</h1>
                <nav>
                    <button id="logout-btn">Logout</button>
                </nav>
            </header>
            <main id="main-content"></main>
            <footer>
                <p>&copy; 2024 Hexaware Technologies Limited. All rights reserved.</p>
            </footer>
        </div>
        ${renderModal()}
        ${renderEditModal()}
    `;

    const mainContent = document.getElementById('main-content')!;
    if (isConsultant) {
        renderConsultantView(mainContent);
    } else {
        renderAdminView(mainContent);
    }

    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    
    // Modal listeners
    document.querySelector('.modal-close-btn')?.addEventListener('click', hideModal);
    const modalOverlay = document.querySelector('.modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                hideModal();
            }
        });
    }

    // Edit Modal listeners
    document.getElementById('edit-consultant-form')?.addEventListener('submit', handleUpdateConsultant);
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
        state.editingConsultantId = null;
        render();
    });
}

function renderLoginPage() {
    appRoot.innerHTML = `
        <div id="login-page">
            <div class="login-container">
                <h2>Welcome</h2>
                <div class="login-tabs">
                    <button class="${state.currentLoginTab === 'login' ? 'active' : ''}" data-tab="login">Login</button>
                    <button class="${state.currentLoginTab === 'register' ? 'active' : ''}" data-tab="register">Register</button>
                </div>
                ${state.loginError ? `<p class="error-message">${state.loginError}</p>` : ''}
                <form class="login-form" id="login-form">
                    <input type="text" name="name" placeholder="Name / Username" required>
                    <input type="password" name="password" placeholder="Password" required>
                    <button type="submit" class="primary-btn">
                        ${state.currentLoginTab === 'login' ? 'Login' : 'Register'}
                    </button>
                </form>
            </div>
        </div>
    `;

    document.querySelector('.login-tabs')?.addEventListener('click', handleTabSwitch);
    document.getElementById('login-form')?.addEventListener('submit', state.currentLoginTab === 'login' ? handleLogin : handleRegister);
}

function renderConsultantView(container: HTMLElement) {
    const consultant = consultants.find(c => c.id === state.loggedInUser?.id);
    if (!consultant) {
        handleLogout();
        return;
    }

    const attendedMeetings = consultant.meetings.filter(m => m.status === 'Attended').length;

    let tabContent = '';
    switch (state.activeConsultantTab) {
        case 'attendance':
            tabContent = `
                <h3>Attendance Agent</h3>
                <p>Log your attendance for scheduled bench meetings.</p>
                <ul class="meeting-list">
                    ${consultant.meetings.map(meeting => `
                        <li class="meeting-item">
                            <span class="meeting-title">${meeting.title}</span>
                            <div class="meeting-details">
                                <span class="status ${meeting.status.toLowerCase()}">${meeting.status}</span>
                                ${meeting.status === 'Pending' 
                                    ? `<button class="log-attendance-btn secondary-btn" data-meeting-id="${meeting.id}">Log Attendance</button>`
                                    : `<span class="meeting-notes">${meeting.notes ? `Notes: ${meeting.notes}`: ''}</span>`
                                }
                            </div>
                        </li>
                    `).join('')}
                </ul>
            `;
            break;
        case 'training':
            tabContent = `
                <h3>Training Agent</h3>
                <p>Log a completed training course or certification.</p>
                <div class="form-group">
                   <input type="text" id="training-name-input" placeholder="e.g., AWS Certified Developer">
                   <button id="log-training-btn" class="secondary-btn">Log Training</button>
                </div>
                <p style="margin-top: 1.5rem;">Get personalized training recommendations based on your skills.</p>
                <button id="suggest-training-btn" class="primary-btn" ${state.isSuggestingTraining ? 'disabled' : ''}>
                    ${state.isSuggestingTraining ? '<span class="loader"></span> Thinking...' : 'Suggest Training'}
                </button>
            `;
            break;
        case 'opportunities':
            tabContent = `
                <h3>My Opportunities</h3>
                <p>A log of all opportunities provided during your bench period.</p>
                <div class="opportunity-log-content">
                    ${renderOpportunityLog(consultant)}
                </div>
            `;
            break;
        case 'resume':
        default:
            tabContent = `
                <h3>Resume Agent</h3>
                <div class="file-upload-wrapper">
                    <label for="resume-upload" class="file-upload-label">Upload Resume PDF</label>
                    <input type="file" id="resume-upload" accept=".pdf">
                    <span id="file-name">${state.selectedFile?.name || 'No file selected.'}</span>
                </div>
                <button id="analyze-resume-btn" class="primary-btn" ${state.isLoading || !state.selectedFile ? 'disabled' : ''}>
                    ${state.isLoading ? '<span class="loader"></span> Analyzing...' : 'Analyze Resume'}
                </button>
                <div id="resume-analytics">
                    ${consultant.resumeAnalytics ? renderResumeAnalytics(consultant.resumeAnalytics) : ''}
                </div>
            `;
            break;
    }

    container.innerHTML = `
        <div class="view-container consultant-view">
            <div class="view-header">
                <h2>${consultant.name}'s Dashboard</h2>
            </div>
            
            <div class="dashboard-grid">
                <div class="card">
                    <h3>Resume Status</h3>
                    <p class="status ${consultant.resumeStatus.toLowerCase()}">${consultant.resumeStatus}</p>
                </div>
                <div class="card">
                    <h3>Attendance</h3>
                    <p class="status">${attendedMeetings} / ${consultant.meetings.length} Meetings</p>
                </div>
                <div class="card">
                    <h3>Opportunities Provided</h3>
                    <p class="status">${consultant.opportunities.count}</p>
                </div>
                <div class="card">
                    <h3>Training Progress</h3>
                    <p class="status ${consultant.trainingStatus.replace(' ', '-').toLowerCase()}">${consultant.trainingStatus}</p>
                </div>
            </div>

            <div class="workflow-section">
                <h3>My Workflow</h3>
                ${renderProgressBar(consultant)}
            </div>

            <div class="agent-container">
                <div class="agent-tabs">
                    <button class="agent-tab ${state.activeConsultantTab === 'resume' ? 'active' : ''}" data-tab="resume">Resume Agent</button>
                    <button class="agent-tab ${state.activeConsultantTab === 'attendance' ? 'active' : ''}" data-tab="attendance">Attendance Agent</button>
                    <button class="agent-tab ${state.activeConsultantTab === 'training' ? 'active' : ''}" data-tab="training">Training Agent</button>
                    <button class="agent-tab ${state.activeConsultantTab === 'opportunities' ? 'active' : ''}" data-tab="opportunities">Opportunities</button>
                </div>
                <div class="agent-tab-content">
                    ${tabContent}
                </div>
            </div>

            <div class="training-journey-section">
                <h3>My Training Journey</h3>
                <div class="training-journey-content">
                    ${renderTrainingJourney(consultant)}
                </div>
            </div>
        </div>
    `;

    document.querySelector('.agent-tabs')?.addEventListener('click', handleConsultantTabSwitch);
    if (state.activeConsultantTab === 'resume') {
        document.getElementById('resume-upload')?.addEventListener('change', handleFileSelect);
        document.getElementById('analyze-resume-btn')?.addEventListener('click', handleAnalyzeResume);
    } else if (state.activeConsultantTab === 'attendance') {
        document.querySelector('.meeting-list')?.addEventListener('click', handleLogAttendance);
    } else if (state.activeConsultantTab === 'training') {
        document.getElementById('log-training-btn')?.addEventListener('click', handleLogTraining);
        document.getElementById('suggest-training-btn')?.addEventListener('click', handleSuggestTraining);
    }
}

function renderProgressBar(consultant: Consultant) {
    const steps = Object.values(consultant.workflow);
    const completedCount = steps.filter(Boolean).length;
    const progressPercentage = (completedCount / steps.length) * 100;

    const stepLabels = [
        { key: 'resumeUpdated', label: 'Resume Updated' },
        { key: 'attendanceReported', label: 'Attendance Reported' },
        { key: 'opportunitiesDocumented', label: 'Opportunities Documented' },
        { key: 'trainingCompleted', label: 'Training Completed' }
    ];

    return `
        <div class="progress-bar-container">
            <div class="progress-bar-segment" style="width: ${progressPercentage}%;"></div>
        </div>
        <div class="workflow-steps">
            ${stepLabels.map(step => `
                <span class="workflow-step ${(consultant.workflow as any)[step.key] ? 'completed' : ''}">
                    ${step.label}
                </span>
            `).join('')}
        </div>
    `;
}

function renderResumeAnalytics(analytics: ResumeAnalytics) {
    return `
        <h4>Resume Analytics</h4>
        <div class="analytics-grid">
            <div class="analytics-item">
                <h5>Professional Summary</h5>
                <p>${analytics.summary}</p>
            </div>
            <div class="analytics-item">
                <h5>Years of Experience</h5>
                <p>${analytics.years_of_experience} years</p>
            </div>
        </div>
        <div class="analytics-item" style="margin-top: 1rem;">
             <h5>Key Projects & Highlights</h5>
             <p>${analytics.project_highlights.join(', ')}</p>
        </div>
        <div class="analytics-item" style="margin-top: 1rem;">
             <h5>Skills</h5>
             <ul>${analytics.extracted_skills.map(skill => `<li>${skill}</li>`).join('')}</ul>
        </div>
    `;
}

function renderTrainingJourney(consultant: Consultant) {
    if (!consultant.trainingHistory || consultant.trainingHistory.length === 0) {
        return '<p>No training has been logged yet.</p>';
    }
    return `
        <ul>
            ${consultant.trainingHistory.map(t => `<li><strong>${t.name}</strong> - Logged on ${t.date}</li>`).join('')}
        </ul>
    `;
}

function renderOpportunityLog(consultant: Consultant) {
    if (!consultant.opportunities || consultant.opportunities.descriptions.length === 0) {
        return '<p>No opportunities have been logged yet.</p>';
    }
    return `
        <ul>
            ${consultant.opportunities.descriptions.map(desc => `<li>${desc}</li>`).join('')}
        </ul>
    `;
}

function renderAdminView(container: HTMLElement) {
    const filteredConsultants = filterConsultants();
    const allSkills = [...new Set(consultants.flatMap(c => c.skills))];
    const allDepartments = ['Technology', 'Finance', 'Healthcare'];
    const allStatuses = ['On Bench', 'In Project'];

    container.innerHTML = `
        <div class="view-container admin-view">
            <div class="view-header">
                <h2>Admin Console</h2>
            </div>
            
            <div class="admin-section">
                <h3>Consultant List</h3>
                <div class="filters">
                    <input type="text" id="name-search" placeholder="Search by name..." value="${state.adminFilters.name}">
                    <select id="skill-filter">
                        <option value="">All Skills</option>
                        ${allSkills.map(s => `<option value="${s}" ${state.adminFilters.skill === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <select id="dept-filter">
                        <option value="">All Departments</option>
                        ${allDepartments.map(d => `<option value="${d}" ${state.adminFilters.department === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                    <select id="status-filter">
                        <option value="">All Statuses</option>
                        ${allStatuses.map(s => `<option value="${s}" ${state.adminFilters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>

                <table class="consultant-table">
                    <thead>
                        <tr><th>Name</th><th>Department</th><th>Status</th><th>Attendance</th><th>Opportunities</th><th>Trainings</th><th>Skills</th><th>Resume</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                        ${filteredConsultants.map(c => `
                            <tr>
                                <td>${c.name}</td>
                                <td>${c.department}</td>
                                <td>${c.status}</td>
                                <td>${c.meetings.filter(m => m.status === 'Attended').length} / ${c.meetings.length}</td>
                                <td>${c.opportunities.count}</td>
                                <td>${c.trainingHistory.length}</td>
                                <td>
                                    <div class="skills-cell-content">
                                        ${c.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                                        ${c.skills.length === 0 ? 'No skills listed' : ''}
                                    </div>
                                </td>
                                <td><span class="status ${c.resumeStatus.toLowerCase()}">${c.resumeStatus}</span></td>
                                <td class="action-buttons">
                                    <button class="action-btn edit-btn" data-id="${c.id}" title="Edit Consultant">✏️</button>
                                    <button class="action-btn log-opp-btn" data-id="${c.id}" title="Log Opportunity">+</button>
                                    <button class="action-btn analyze-att-btn" data-id="${c.id}" title="Analyze Attendance" ${state.isAdminLoading.attendance[c.id] ? 'disabled' : ''}>
                                        ${state.isAdminLoading.attendance[c.id] ? '<span class="loader-small"></span>' : '📊'}
                                    </button>
                                    <button class="action-btn delete-btn" data-id="${c.id}" title="Delete Consultant">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                        ${filteredConsultants.length === 0 ? '<tr><td colspan="9">No consultants match filters.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
            
            <div class="admin-section">
                <h3>Department Analytics</h3>
                <div class="department-analytics-controls">
                     <select id="dept-analytics-filter">
                        <option value="">Select Department</option>
                        ${allDepartments.map(d => `<option value="${d}">${d}</option>`).join('')}
                    </select>
                    <button id="analyze-dept-opp-btn" class="primary-btn" ${state.isAdminLoading.department ? 'disabled' : ''}>
                        ${state.isAdminLoading.department ? '<span class="loader"></span> Analyzing...' : 'Analyze Dept. Opportunities'}
                    </button>
                </div>
            </div>
        </div>
    `;
    
    container.querySelector('.consultant-table tbody')?.addEventListener('click', handleAdminTableActions);
    container.querySelector('#name-search')?.addEventListener('input', handleFilterChange);
    container.querySelector('#skill-filter')?.addEventListener('change', handleFilterChange);
    container.querySelector('#dept-filter')?.addEventListener('change', handleFilterChange);
    container.querySelector('#status-filter')?.addEventListener('change', handleFilterChange);
    container.querySelector('#analyze-dept-opp-btn')?.addEventListener('click', handleAnalyzeDepartmentOpportunities);
}

function renderModal() {
    if (!state.modal.isOpen) return '';
    return `
        <div class="modal-overlay">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>${state.modal.title}</h2>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <p>${state.modal.content.replace(/\n/g, '<br>')}</p>
                </div>
            </div>
        </div>
    `;
}

function renderEditModal() {
    if (!state.editingConsultantId) return '';
    const consultant = consultants.find(c => c.id === state.editingConsultantId);
    if (!consultant) return '';

    const departments = ['Technology', 'Finance', 'Healthcare', 'Unassigned'];
    const statuses = ['On Bench', 'In Project'];

    return `
        <div class="modal-overlay">
            <div class="modal-content edit-modal-content">
                <div class="modal-header">
                    <h2>Edit ${consultant.name}</h2>
                    <button id="cancel-edit-btn" class="modal-close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="edit-consultant-form">
                        <div class="form-group-vertical">
                            <label for="edit-name">Name</label>
                            <input type="text" id="edit-name" name="name" value="${consultant.name}" required>
                        </div>
                        <div class="form-group-vertical">
                            <label for="edit-department">Department</label>
                            <select id="edit-department" name="department" required>
                                ${departments.map(d => `<option value="${d}" ${consultant.department === d ? 'selected' : ''}>${d}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group-vertical">
                            <label for="edit-status">Status</label>
                            <select id="edit-status" name="status" required>
                                ${statuses.map(s => `<option value="${s}" ${consultant.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-actions">
                            <button type="submit" class="primary-btn">Save Changes</button>
                            <button type="button" id="cancel-edit-btn-form" class="secondary-btn">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
}


// --- EVENT HANDLERS & LOGIC ---
function showModal(title: string, content: string) {
    state.modal = { isOpen: true, title, content };
    render();
}

function hideModal() {
    state.modal = { isOpen: false, title: '', content: '' };
    render();
}

function handleTabSwitch(e: Event) {
    const target = e.target as HTMLButtonElement;
    if (target.matches('button')) {
        state.currentLoginTab = target.dataset.tab as 'login' | 'register';
        render();
    }
}

function handleConsultantTabSwitch(e: Event) {
    const target = e.target as HTMLButtonElement;
    if (target.matches('button')) {
        state.activeConsultantTab = target.dataset.tab as 'resume' | 'attendance' | 'training' | 'opportunities';
        render();
    }
}

function handleLogin(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    if (name.toLowerCase() === 'admin' && password === 'admin') {
        state.loggedInUser = { id: 'admin', type: 'admin' };
    } else {
        const consultant = consultants.find(c => c.name.toLowerCase() === name.toLowerCase() && c.password === password);
        if (consultant) {
            state.loggedInUser = { id: consultant.id, type: 'consultant' };
        } else {
            state.loginError = "Invalid credentials. Please try again or register.";
        }
    }
    
    if(state.loggedInUser) {
        localStorage.setItem('loggedInUser', JSON.stringify(state.loggedInUser));
    }
    render();
}

function handleRegister(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    if (consultants.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        state.loginError = "A consultant with this name already exists.";
        render();
        return;
    }

    const newConsultant: Consultant = {
        id: Date.now(),
        name: name,
        password: password,
        department: 'Unassigned',
        status: 'On Bench',
        resumeStatus: 'Pending',
        meetings: getInitialMeetings(),
        opportunities: { count: 0, descriptions: [] },
        trainingStatus: 'Not Started',
        skills: [],
        workflow: {
            resumeUpdated: false,
            attendanceReported: false,
            opportunitiesDocumented: false,
            trainingCompleted: false,
        },
        resumeAnalytics: null,
        trainingHistory: [],
    };

    consultants.push(newConsultant);
    saveConsultants();
    state.loggedInUser = { id: newConsultant.id, type: 'consultant' };
    localStorage.setItem('loggedInUser', JSON.stringify(state.loggedInUser));
    render();
}

function handleLogout() {
    state.loggedInUser = null;
    state.editingConsultantId = null;
    localStorage.removeItem('loggedInUser');
    render();
}

function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        state.selectedFile = target.files[0];
        render();
    }
}

async function getTextFromPdf(file: File): Promise<string> {
    const uri = URL.createObjectURL(file);
    const pdf = await pdfjsLib.getDocument({ url: uri }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ');
    }
    URL.revokeObjectURL(uri);
    return text;
}

async function handleAnalyzeResume() {
    if (state.isLoading || !state.selectedFile || !state.loggedInUser) return;

    const consultant = consultants.find(c => c.id === state.loggedInUser?.id);
    if (!consultant) return;
    
    state.isLoading = true;
    render(); 

    try {
        const resumeText = await getTextFromPdf(state.selectedFile);
        
        const responseSchema = {
            type: Type.OBJECT,
            properties: {
                summary: { type: Type.STRING, description: "A 2-3 sentence professional summary of the candidate." },
                extracted_skills: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of professional skills, technologies, and methodologies." },
                years_of_experience: { type: Type.NUMBER, description: "An estimated total number of years of professional experience." },
                project_highlights: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of 2-3 key project accomplishments or highlights."},
                resume_status: { type: Type.STRING, description: "Should be 'Updated' or 'Pending'." }
            },
            required: ['summary', 'extracted_skills', 'years_of_experience', 'project_highlights', 'resume_status']
        };

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Analyze the following resume text and provide a structured overview. Resume Text: "${resumeText}"`,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        
        const result: ResumeAnalytics = JSON.parse(response.text);

        consultant.resumeAnalytics = result;
        consultant.skills = [...new Set([...consultant.skills, ...result.extracted_skills])];
        consultant.resumeStatus = result.resume_status;
        if (consultant.resumeStatus === 'Updated') {
            consultant.workflow.resumeUpdated = true;
        }
        saveConsultants();

    } catch (error) {
        console.error("Gemini API Error:", error);
        showModal("Error", "Failed to analyze resume. Please check the console for details.");
    } finally {
        state.isLoading = false;
        state.selectedFile = null;
        render();
    }
}

function handleLogAttendance(e: Event) {
    const target = e.target as HTMLElement;
    const logButton = target.closest('.log-attendance-btn');
    if (!logButton) return;
    
    const meetingId = parseInt(logButton.getAttribute('data-meeting-id')!, 10);
    const consultant = consultants.find(c => c.id === state.loggedInUser?.id);
    if (!consultant) return;
    
    const meeting = consultant.meetings.find(m => m.id === meetingId);
    if (!meeting) return;

    const notes = prompt("Add any notes for this meeting (optional):");
    
    meeting.status = 'Attended';
    meeting.notes = notes || '';
    
    const attendedCount = consultant.meetings.filter(m => m.status === 'Attended').length;
    if (attendedCount > 0) {
        consultant.workflow.attendanceReported = true;
    }

    saveConsultants();
    showModal('Attendance Logged', `Attendance for "${meeting.title}" logged successfully!`);
}

function handleLogTraining() {
    const consultant = consultants.find(c => c.id === state.loggedInUser?.id);
    const input = document.getElementById('training-name-input') as HTMLInputElement;
    if (!consultant || !input || !input.value) return;

    const trainingName = input.value.trim();
    if (trainingName) {
        if (!consultant.skills.some(s => s.toLowerCase() === trainingName.toLowerCase())) {
            consultant.skills.push(trainingName);
        }
        consultant.trainingHistory.push({ name: trainingName, date: new Date().toLocaleDateString() });
        consultant.trainingStatus = 'Completed';
        consultant.workflow.trainingCompleted = true;
        saveConsultants();
        input.value = '';
        render();
    }
}

async function handleSuggestTraining() {
    const consultant = consultants.find(c => c.id === state.loggedInUser?.id);
    if (!consultant || state.isSuggestingTraining) return;

    const skills = consultant.skills.length > 0 ? consultant.skills.join(', ') : 'a beginner level';
    const prompt = `A consultant has the following skills: ${skills}. Based on these skills, recommend 3 specific and actionable training courses or certifications they should pursue to enhance their career profile. Provide only the list of recommendations.`;

    state.isSuggestingTraining = true;
    render();

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
        });
        showModal('AI Training Suggestions', response.text);
    } catch (error) {
        console.error("Gemini API Error:", error);
        showModal('Error', "Could not get training suggestions at this time.");
    } finally {
        state.isSuggestingTraining = false;
        render();
    }
}

function handleFilterChange(e: Event) {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const filterKey = target.id.split('-')[0] as keyof AppState['adminFilters'];
    state.adminFilters[filterKey as 'name' | 'skill' | 'department' | 'status'] = target.value;
    render();
}

function filterConsultants() {
    const { name, skill, department, status } = state.adminFilters;
    return consultants.filter(c => 
        c.name.toLowerCase().includes(name.toLowerCase()) &&
        (skill === '' || c.skills.includes(skill)) &&
        (department === '' || c.department === department) &&
        (status === '' || c.status === status)
    );
}

async function handleAdminTableActions(e: Event) {
    const target = e.target as HTMLElement;
    const id = target.closest('[data-id]')?.getAttribute('data-id');

    if (!id) return;
    const consultantId = parseInt(id, 10);
    const consultant = consultants.find(c => c.id === consultantId);
    if (!consultant) return;

    if (target.closest('.delete-btn')) {
        if (confirm('Are you sure you want to delete this consultant?')) {
            consultants = consultants.filter(c => c.id !== consultantId);
            saveConsultants();
            render();
        }
    } else if (target.closest('.log-opp-btn')) {
        const description = prompt("Enter a brief description for this opportunity:", "Client interview for a new role.");
        if (description) {
            consultant.opportunities.count += 1;
            consultant.opportunities.descriptions.push(description);
            consultant.workflow.opportunitiesDocumented = true;
            saveConsultants();
            render();
        }
    } else if (target.closest('.analyze-att-btn')) {
        await handleAnalyzeAttendance(consultantId);
    } else if (target.closest('.edit-btn')) {
        state.editingConsultantId = consultantId;
        render();
    }
}

function handleUpdateConsultant(e: Event) {
    e.preventDefault();
    if (!state.editingConsultantId) return;

    const consultant = consultants.find(c => c.id === state.editingConsultantId);
    if (!consultant) return;
    
    const form = e.target as HTMLFormElement;
    consultant.name = (form.elements.namedItem('name') as HTMLInputElement).value;
    consultant.department = (form.elements.namedItem('department') as HTMLSelectElement).value as Consultant['department'];
    consultant.status = (form.elements.namedItem('status') as HTMLSelectElement).value as Consultant['status'];
    
    saveConsultants();
    state.editingConsultantId = null;
    render();
}

async function handleAnalyzeAttendance(consultantId: number) {
    const consultant = consultants.find(c => c.id === consultantId);
    if (!consultant || state.isAdminLoading.attendance[consultantId]) return;

    state.isAdminLoading.attendance[consultantId] = true;
    render();
    
    try {
        const attendedCount = consultant.meetings.filter(m => m.status === 'Attended').length;
        const prompt = `Generate a brief, professional summary of a consultant's meeting attendance record. The record is: ${attendedCount} out of ${consultant.meetings.length} meetings attended. Comment on their level of engagement.`;
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        showModal(`Attendance Summary for ${consultant.name}`, response.text);
    } catch (error) {
        console.error("Gemini API Error (Attendance):", error);
        showModal('Error', "Could not generate attendance summary.");
    } finally {
        state.isAdminLoading.attendance[consultantId] = false;
        render();
    }
}

async function handleAnalyzeDepartmentOpportunities() {
    const deptSelect = document.getElementById('dept-analytics-filter') as HTMLSelectElement;
    const department = deptSelect.value;
    if (!department || state.isAdminLoading.department) return;

    state.isAdminLoading.department = true;
    render();

    try {
        const deptConsultants = consultants.filter(c => c.department === department);
        const allDescriptions = deptConsultants.flatMap(c => c.opportunities.descriptions);

        if (allDescriptions.length === 0) {
            showModal('No Data', `No opportunities have been logged for the ${department} department.`);
            state.isAdminLoading.department = false;
            render();
            return;
        }

        const prompt = `Based on the following list of logged opportunities for the ${department} department, identify the top 3 most common skills, technologies, or roles requested by clients. Provide a concise summary. List of opportunities: "${allDescriptions.join('; ')}"`;
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        showModal(`Opportunity Analysis for ${department}`, response.text);

    } catch (error) {
        console.error("Gemini API Error (Department):", error);
        showModal('Error', "Could not generate department opportunity analysis.");
    } finally {
        state.isAdminLoading.department = false;
        render();
    }
}

// --- INITIALIZATION ---
function init() {
    loadConsultants();
    const storedUser = localStorage.getItem('loggedInUser');
    if (storedUser) {
        state.loggedInUser = JSON.parse(storedUser);
    }
    render();
}

init();
