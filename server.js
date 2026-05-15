const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// DATABASE CONNECTION
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "student_api_db"
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
        return;
    }
    console.log("Connected to MySQL database: student_api_db");
});

// ROOT
app.get("/", (req, res) => {
    res.json({ message: "S3 API is running" });
});

// HEALTH CHECK
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});



// CENTRAL ATTENDANCE STATUS VALUES
const ATTENDANCE_STATUSES = [
    { value: "Present", label: "Present" },
    { value: "Absent", label: "Absent" },
    { value: "Permission", label: "Permission" },
    { value: "Excused", label: "Excused" },
    { value: "Medical Leave", label: "Medical Leave" },
    { value: "Late", label: "Late" }
];


function resolveAttendanceEvent(eventId, callback) {
    if (!eventId) {
        return callback(null, { event_id: null, teacher_id: null });
    }

    const query = `
        SELECT events.event_id, courses.teacher_id
        FROM events
        LEFT JOIN courses ON events.course_id = courses.course_id
        WHERE events.event_id = ?
        LIMIT 1
    `;

    db.query(query, [eventId], (err, results) => {
        if (err) return callback(err);

        if (results.length === 0) {
            return callback(new Error("Selected event was not found"));
        }

        callback(null, {
            event_id: results[0].event_id,
            teacher_id: results[0].teacher_id || null
        });
    });
}
function isValidAttendanceStatus(status) {
    return ATTENDANCE_STATUSES.some((item) => item.value === status);
}

app.get("/api/attendance/statuses", (req, res) => {
    res.json({
        status: "success",
        data: ATTENDANCE_STATUSES
    });
});

// =========================
// STUDENTS API
// =========================
app.get("/api/students", (req, res) => {
    const query = `
        SELECT 
            students.student_id,
            students.student_number,
            students.first_name,
            students.last_name,
            courses.course_code,
            sections.section_name,
            sections.year_level,
            students.email,
            students.contact_number,
            students.status
        FROM students
        LEFT JOIN courses ON students.course_id = courses.course_id
        LEFT JOIN sections ON students.section_id = sections.section_id
        ORDER BY students.student_id ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error("Students API Error:", err.message);
            return res.status(500).json({
                status: "error",
                message: err.message
            });
        }

        res.json({
            status: "success",
            data: results
        });
    });
});

// GET single student
app.get("/api/students/:id", (req, res) => {
    const studentId = req.params.id;
    const query = `
        SELECT 
            students.student_id,
            students.student_number,
            students.first_name,
            students.last_name,
            courses.course_code,
            sections.section_name,
            sections.year_level,
            students.email,
            students.contact_number,
            students.status
        FROM students
        LEFT JOIN courses ON students.course_id = courses.course_id
        LEFT JOIN sections ON students.section_id = sections.section_id
        WHERE students.student_id = ?
    `;

    db.query(query, [studentId], (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (results.length === 0) {
            return res.status(404).json({ status: "error", message: "Student not found" });
        }

        res.json({ status: "success", data: results[0] });
    });
});

function resolveStudentCourseAndSection(body, callback) {
    const courseId = body.course_id || null;
    const sectionId = body.section_id || null;
    const courseCode = body.course_code || null;
    const sectionName = body.section_name || null;
    const yearLevel = body.year_level || null;

    if (courseId && sectionId) {
        return callback(null, { course_id: courseId, section_id: sectionId });
    }

    if (!courseCode || !sectionName || !yearLevel) {
        return callback(new Error("course_id and section_id are required, or course_code, section_name, and year_level must be provided"));
    }

    const query = `
        SELECT sections.section_id, courses.course_id
        FROM sections
        JOIN courses ON sections.course_id = courses.course_id
        WHERE courses.course_code = ?
          AND sections.section_name = ?
          AND sections.year_level = ?
        LIMIT 1
    `;

    db.query(query, [courseCode, sectionName, yearLevel], (err, results) => {
        if (err) return callback(err);

        if (results.length === 0) {
            return callback(new Error("Matching course and section were not found"));
        }

        callback(null, results[0]);
    });
}

// POST student
app.post("/api/students", (req, res) => {
    const { student_number, first_name, last_name, email, contact_number, status } = req.body;

    if (!student_number || !first_name || !last_name) {
        return res.status(400).json({
            status: "error",
            message: "student_number, first_name, and last_name are required"
        });
    }

    resolveStudentCourseAndSection(req.body, (resolveErr, resolved) => {
        if (resolveErr) {
            return res.status(400).json({ status: "error", message: resolveErr.message });
        }

        const query = `
            INSERT INTO students
                (student_number, first_name, last_name, course_id, section_id, email, contact_number, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(
            query,
            [student_number, first_name, last_name, resolved.course_id, resolved.section_id, email || null, contact_number || null, status || "Active"],
            (err, result) => {
                if (err) return res.status(500).json({ status: "error", message: err.message });

                res.json({
                    status: "success",
                    message: "Student added successfully",
                    student_id: result.insertId
                });
            }
        );
    });
});

// UPDATE student
app.put("/api/students/:id", (req, res) => {
    const studentId = req.params.id;
    const { student_number, first_name, last_name, email, contact_number, status } = req.body;

    if (!student_number || !first_name || !last_name) {
        return res.status(400).json({
            status: "error",
            message: "student_number, first_name, and last_name are required"
        });
    }

    resolveStudentCourseAndSection(req.body, (resolveErr, resolved) => {
        if (resolveErr) {
            return res.status(400).json({ status: "error", message: resolveErr.message });
        }

        const query = `
            UPDATE students
            SET student_number = ?,
                first_name = ?,
                last_name = ?,
                course_id = ?,
                section_id = ?,
                email = ?,
                contact_number = ?,
                status = ?
            WHERE student_id = ?
        `;

        db.query(
            query,
            [student_number, first_name, last_name, resolved.course_id, resolved.section_id, email || null, contact_number || null, status || "Active", studentId],
            (err, result) => {
                if (err) return res.status(500).json({ status: "error", message: err.message });

                if (result.affectedRows === 0) {
                    return res.status(404).json({ status: "error", message: "Student not found" });
                }

                res.json({ status: "success", message: "Student updated successfully" });
            }
        );
    });
});

// DELETE student
app.delete("/api/students/:id", (req, res) => {
    const studentId = req.params.id;

    db.query("DELETE FROM students WHERE student_id = ?", [studentId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Student not found" });
        }

        res.json({ status: "success", message: "Student deleted successfully" });
    });
});

// =========================
// ATTENDANCE API
// =========================

// GET all attendance
app.get("/api/attendance", (req, res) => {
    const query = `
        SELECT 
            attendance.attendance_id,
            attendance.student_id,
            students.student_number,
            CONCAT(students.first_name, ' ', students.last_name) AS student_name,
            attendance.event_id,
            events.event_name,
            COALESCE(event_courses.course_code, student_courses.course_code) AS subject_code,
            COALESCE(event_courses.course_name, student_courses.course_name) AS subject_name,
            teachers.teacher_name,
            attendance.attendance_date,
            attendance.status,
            attendance.time_in,
            attendance.remarks
        FROM attendance
        JOIN students ON attendance.student_id = students.student_id
        LEFT JOIN events ON attendance.event_id = events.event_id
        LEFT JOIN courses event_courses ON events.course_id = event_courses.course_id
        LEFT JOIN courses student_courses ON students.course_id = student_courses.course_id
        LEFT JOIN teachers ON teachers.teacher_id = COALESCE(attendance.teacher_id, event_courses.teacher_id, student_courses.teacher_id)
        ORDER BY attendance.attendance_id DESC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        res.json({ status: "success", data: results });
    });
});
// GET attendance by student
app.get("/api/attendance/student/:student_id", (req, res) => {
    const studentId = req.params.student_id;
    const query = `
        SELECT 
            attendance.attendance_id,
            attendance.student_id,
            students.student_number,
            CONCAT(students.first_name, ' ', students.last_name) AS student_name,
            attendance.event_id,
            events.event_name,
            COALESCE(event_courses.course_code, student_courses.course_code) AS subject_code,
            COALESCE(event_courses.course_name, student_courses.course_name) AS subject_name,
            teachers.teacher_name,
            attendance.attendance_date,
            attendance.status,
            attendance.time_in,
            attendance.remarks
        FROM attendance
        JOIN students ON attendance.student_id = students.student_id
        LEFT JOIN events ON attendance.event_id = events.event_id
        LEFT JOIN courses event_courses ON events.course_id = event_courses.course_id
        LEFT JOIN courses student_courses ON students.course_id = student_courses.course_id
        LEFT JOIN teachers ON teachers.teacher_id = COALESCE(attendance.teacher_id, event_courses.teacher_id, student_courses.teacher_id)
        WHERE attendance.student_id = ?
        ORDER BY attendance.attendance_date DESC, attendance.attendance_id DESC
    `;

    db.query(query, [studentId], (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        res.json({ status: "success", data: results });
    });
});

// POST attendance
app.post("/api/attendance", (req, res) => {
    const { student_id, event_id, attendance_date, status, time_in, remarks } = req.body;

    if (!student_id || !attendance_date || !status) {
        return res.status(400).json({
            status: "error",
            message: "student_id, attendance_date, and status are required"
        });
    }

    if (!isValidAttendanceStatus(status)) {
        return res.status(400).json({
            status: "error",
            message: "Invalid attendance status"
        });
    }

    resolveAttendanceEvent(event_id, (resolveErr, attendanceContext) => {
        if (resolveErr) {
            return res.status(400).json({ status: "error", message: resolveErr.message });
        }

        const query = `
            INSERT INTO attendance (student_id, event_id, teacher_id, attendance_date, status, time_in, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(
            query,
            [student_id, attendanceContext.event_id, attendanceContext.teacher_id, attendance_date, status, time_in || null, remarks || null],
            (err, result) => {
                if (err) return res.status(500).json({ status: "error", message: err.message });

                res.json({
                    status: "success",
                    message: "Attendance added",
                    id: result.insertId
                });
            }
        );
    });
});

// UPDATE attendance
app.put("/api/attendance/:id", (req, res) => {
    const id = req.params.id;
    const { student_id, event_id, attendance_date, status, time_in, remarks } = req.body;

    if (!student_id || !status) {
        return res.status(400).json({
            status: "error",
            message: "student_id and status are required"
        });
    }

    if (!isValidAttendanceStatus(status)) {
        return res.status(400).json({
            status: "error",
            message: "Invalid attendance status"
        });
    }

    resolveAttendanceEvent(event_id, (resolveErr, attendanceContext) => {
        if (resolveErr) {
            return res.status(400).json({ status: "error", message: resolveErr.message });
        }

        const query = `
            UPDATE attendance
            SET student_id = ?,
                event_id = COALESCE(?, event_id),
                teacher_id = COALESCE(?, teacher_id),
                attendance_date = COALESCE(?, attendance_date),
                status = ?,
                time_in = COALESCE(?, time_in),
                remarks = COALESCE(?, remarks)
            WHERE attendance_id = ?
        `;

        db.query(
            query,
            [student_id, attendanceContext.event_id, attendanceContext.teacher_id, attendance_date || null, status, time_in || null, remarks || null, id],
            (err, result) => {
                if (err) return res.status(500).json({ status: "error", message: err.message });

                if (result.affectedRows === 0) {
                    return res.status(404).json({ status: "error", message: "Attendance not found" });
                }

                res.json({ status: "success", message: "Attendance updated successfully" });
            }
        );
    });
});

// DELETE attendance
app.delete("/api/attendance/:id", (req, res) => {
    const id = req.params.id;

    db.query("DELETE FROM attendance WHERE attendance_id = ?", [id], (err) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        res.json({ status: "success", message: "Deleted" });
    });
});

// =========================
// EVENTS API
// =========================

app.get("/api/events", (req, res) => {
    const query = `
        SELECT 
            events.event_id,
            events.course_id,
            courses.teacher_id,
            events.event_name,
            courses.course_code,
            courses.course_name,
            events.room,
            events.event_date
        FROM events
        JOIN courses ON events.course_id = courses.course_id
        ORDER BY events.event_date DESC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/events", (req, res) => {
    const { event_name, course_id, room, event_date } = req.body;

    if (!event_name || !course_id || !event_date) {
        return res.status(400).json({
            status: "error",
            message: "event_name, course_id, and event_date are required"
        });
    }

    const query = `
        INSERT INTO events (event_name, course_id, room, event_date)
        VALUES (?, ?, ?, ?)
    `;

    db.query(query, [event_name, course_id, room || null, event_date], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        res.json({
            status: "success",
            message: "Event added successfully",
            event_id: result.insertId
        });
    });
});

app.put("/api/events/:id", (req, res) => {
    const eventId = req.params.id;
    const { event_name, course_id, room, event_date } = req.body;

    if (!event_name || !course_id || !event_date) {
        return res.status(400).json({
            status: "error",
            message: "event_name, course_id, and event_date are required"
        });
    }

    const query = `
        UPDATE events
        SET event_name = ?, course_id = ?, room = ?, event_date = ?
        WHERE event_id = ?
    `;

    db.query(query, [event_name, course_id, room || null, event_date, eventId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Event not found" });
        }

        res.json({ status: "success", message: "Event updated successfully" });
    });
});

app.delete("/api/events/:id", (req, res) => {
    const eventId = req.params.id;

    db.query("DELETE FROM events WHERE event_id = ?", [eventId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Event not found" });
        }

        res.json({ status: "success", message: "Event deleted successfully" });
    });
});






// =========================
// BILLING AND PAYMENTS API
// =========================
app.get("/api/bill-items", (req, res) => {
    db.query("SELECT item_id, item_name, amount FROM bill_items ORDER BY item_id ASC", (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/bill-items", (req, res) => {
    const { item_name, amount } = req.body;

    if (!item_name || amount === undefined || amount === null || amount === "") {
        return res.status(400).json({ status: "error", message: "item_name and amount are required" });
    }

    db.query("INSERT INTO bill_items (item_name, amount) VALUES (?, ?)", [item_name, amount], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", message: "Bill item added successfully", item_id: result.insertId });
    });
});

app.get("/api/payment-methods", (req, res) => {
    db.query("SELECT method_id, method_name FROM payment_methods ORDER BY method_id ASC", (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/payment-methods", (req, res) => {
    const { method_name } = req.body;

    if (!method_name) {
        return res.status(400).json({ status: "error", message: "method_name is required" });
    }

    db.query("INSERT INTO payment_methods (method_name) VALUES (?)", [method_name], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", message: "Payment method added successfully", method_id: result.insertId });
    });
});

app.get("/api/payment-options", (req, res) => {
    const methodId = req.query.method_id;
    let query = `
        SELECT payment_options.option_id, payment_options.method_id, payment_methods.method_name,
               payment_options.option_name, payment_options.option_type
        FROM payment_options
        JOIN payment_methods ON payment_options.method_id = payment_methods.method_id
    `;
    const params = [];

    if (methodId) {
        query += " WHERE payment_options.method_id = ?";
        params.push(methodId);
    }

    query += " ORDER BY payment_options.option_id ASC";

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/payment-options", (req, res) => {
    const { method_id, option_name, option_type } = req.body;

    if (!method_id || !option_name || !option_type) {
        return res.status(400).json({ status: "error", message: "method_id, option_name, and option_type are required" });
    }

    db.query(
        "INSERT INTO payment_options (method_id, option_name, option_type) VALUES (?, ?, ?)",
        [method_id, option_name, option_type],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Payment option added successfully", option_id: result.insertId });
        }
    );
});

app.get("/api/bills", (req, res) => {
    const studentId = req.query.student_id;
    const params = [];
    let whereClause = "";

    if (studentId) {
        whereClause = "WHERE bills.student_id = ?";
        params.push(studentId);
    }

    const query = `
        SELECT
            bills.bill_id,
            bills.student_id,
            students.student_number,
            CONCAT(students.first_name, ' ', students.last_name) AS student_name,
            bills.bill_date,
            bills.status,
            bill_details.detail_id,
            bill_details.item_id,
            bill_details.item_name,
            bill_details.amount
        FROM bills
        JOIN students ON bills.student_id = students.student_id
        LEFT JOIN bill_details ON bills.bill_id = bill_details.bill_id
        ${whereClause}
        ORDER BY bills.bill_id DESC, bill_details.detail_id ASC
    `;

    db.query(query, params, (err, rows) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        const billsById = {};
        const bills = [];

        rows.forEach((row) => {
            if (!billsById[row.bill_id]) {
                billsById[row.bill_id] = {
                    bill_id: row.bill_id,
                    student_id: row.student_id,
                    student_number: row.student_number,
                    student_name: row.student_name,
                    bill_date: row.bill_date,
                    status: row.status,
                    total_amount: 0,
                    items: []
                };
                bills.push(billsById[row.bill_id]);
            }

            if (row.detail_id) {
                const amount = Number(row.amount || 0);
                billsById[row.bill_id].items.push({
                    detail_id: row.detail_id,
                    item_id: row.item_id,
                    item_name: row.item_name,
                    amount
                });
                billsById[row.bill_id].total_amount += amount;
            }
        });

        res.json({ status: "success", data: bills });
    });
});

app.post("/api/bills", (req, res) => {
    const { student_id, item_ids } = req.body;

    if (!student_id || !Array.isArray(item_ids) || item_ids.length === 0) {
        return res.status(400).json({ status: "error", message: "student_id and item_ids are required" });
    }

    db.query("SELECT item_id, item_name, amount FROM bill_items WHERE item_id IN (?)", [item_ids], (itemErr, items) => {
        if (itemErr) return res.status(500).json({ status: "error", message: itemErr.message });

        if (items.length === 0) {
            return res.status(400).json({ status: "error", message: "No valid bill items selected" });
        }

        db.query("INSERT INTO bills (student_id) VALUES (?)", [student_id], (billErr, billResult) => {
            if (billErr) return res.status(500).json({ status: "error", message: billErr.message });

            const billId = billResult.insertId;
            const detailRows = items.map((item) => [billId, item.item_id, item.item_name, item.amount]);

            db.query(
                "INSERT INTO bill_details (bill_id, item_id, item_name, amount) VALUES ?",
                [detailRows],
                (detailErr) => {
                    if (detailErr) return res.status(500).json({ status: "error", message: detailErr.message });
                    res.json({ status: "success", message: "Bill created successfully", bill_id: billId });
                }
            );
        });
    });
});

app.delete("/api/bills/:id", (req, res) => {
    const billId = req.params.id;

    db.query("DELETE FROM bills WHERE bill_id = ?", [billId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Bill not found" });
        }

        res.json({ status: "success", message: "Bill deleted successfully" });
    });
});
// =========================
// PARENTS API
// =========================
app.get("/api/parents", (req, res) => {
    const query = `
        SELECT
            parents.parent_id,
            parents.first_name,
            parents.last_name,
            parents.email,
            parents.contact_number,
            parents.address,
            parents.student_id,
            CONCAT(students.first_name, ' ', students.last_name) AS student_name
        FROM parents
        LEFT JOIN students ON parents.student_id = students.student_id
        ORDER BY parents.parent_id ASC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.get("/api/parents/:id", (req, res) => {
    const parentId = req.params.id;
    const query = `
        SELECT
            parents.parent_id,
            parents.first_name,
            parents.last_name,
            parents.email,
            parents.contact_number,
            parents.address,
            parents.student_id,
            CONCAT(students.first_name, ' ', students.last_name) AS student_name
        FROM parents
        LEFT JOIN students ON parents.student_id = students.student_id
        WHERE parents.parent_id = ?
        LIMIT 1
    `;

    db.query(query, [parentId], (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (results.length === 0) {
            return res.status(404).json({ status: "error", message: "Parent not found" });
        }

        res.json({ status: "success", data: results[0] });
    });
});

app.post("/api/parents", (req, res) => {
    const { first_name, last_name, email, contact_number, address, student_id } = req.body;

    if (!first_name || !last_name) {
        return res.status(400).json({ status: "error", message: "first_name and last_name are required" });
    }

    db.query(
        "INSERT INTO parents (first_name, last_name, email, contact_number, address, student_id) VALUES (?, ?, ?, ?, ?, ?)",
        [first_name, last_name, email || null, contact_number || null, address || null, student_id || null],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Parent added successfully", parent_id: result.insertId });
        }
    );
});

app.put("/api/parents/:id", (req, res) => {
    const parentId = req.params.id;
    const { first_name, last_name, email, contact_number, address, student_id } = req.body;

    if (!first_name || !last_name) {
        return res.status(400).json({ status: "error", message: "first_name and last_name are required" });
    }

    db.query(
        "UPDATE parents SET first_name = ?, last_name = ?, email = ?, contact_number = ?, address = ?, student_id = ? WHERE parent_id = ?",
        [first_name, last_name, email || null, contact_number || null, address || null, student_id || null, parentId],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (result.affectedRows === 0) {
                return res.status(404).json({ status: "error", message: "Parent not found" });
            }

            res.json({ status: "success", message: "Parent updated successfully" });
        }
    );
});

app.delete("/api/parents/:id", (req, res) => {
    const parentId = req.params.id;

    db.query("DELETE FROM parents WHERE parent_id = ?", [parentId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Parent not found" });
        }

        res.json({ status: "success", message: "Parent deleted successfully" });
    });
});
// =========================
// SEMESTERS API
// =========================
app.get("/api/semesters", (req, res) => {
    const query = `
        SELECT semester_id, semester_name, fees
        FROM semesters
        ORDER BY semester_id ASC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.get("/api/semesters/:id", (req, res) => {
    const semesterId = req.params.id;

    db.query(
        "SELECT semester_id, semester_name, fees FROM semesters WHERE semester_id = ? LIMIT 1",
        [semesterId],
        (err, results) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (results.length === 0) {
                return res.status(404).json({ status: "error", message: "Semester not found" });
            }

            res.json({ status: "success", data: results[0] });
        }
    );
});

app.post("/api/semesters", (req, res) => {
    const { semester_name, fees } = req.body;

    if (!semester_name || fees === undefined || fees === null || fees === "") {
        return res.status(400).json({
            status: "error",
            message: "semester_name and fees are required"
        });
    }

    db.query(
        "INSERT INTO semesters (semester_name, fees) VALUES (?, ?)",
        [semester_name, fees],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Semester added successfully", semester_id: result.insertId });
        }
    );
});

app.put("/api/semesters/:id", (req, res) => {
    const semesterId = req.params.id;
    const { semester_name, fees } = req.body;

    if (!semester_name || fees === undefined || fees === null || fees === "") {
        return res.status(400).json({
            status: "error",
            message: "semester_name and fees are required"
        });
    }

    db.query(
        "UPDATE semesters SET semester_name = ?, fees = ? WHERE semester_id = ?",
        [semester_name, fees, semesterId],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (result.affectedRows === 0) {
                return res.status(404).json({ status: "error", message: "Semester not found" });
            }

            res.json({ status: "success", message: "Semester updated successfully" });
        }
    );
});

app.delete("/api/semesters/:id", (req, res) => {
    const semesterId = req.params.id;

    db.query("DELETE FROM semesters WHERE semester_id = ?", [semesterId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Semester not found" });
        }

        res.json({ status: "success", message: "Semester deleted successfully" });
    });
});
// =========================
// SUBJECTS API
// =========================
app.get("/api/subjects", (req, res) => {
    const query = `
        SELECT subject_id, subject_code, subject_name
        FROM subjects
        ORDER BY subject_id ASC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.get("/api/subjects/:id", (req, res) => {
    const subjectId = req.params.id;

    db.query(
        "SELECT subject_id, subject_code, subject_name FROM subjects WHERE subject_id = ? LIMIT 1",
        [subjectId],
        (err, results) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (results.length === 0) {
                return res.status(404).json({ status: "error", message: "Subject not found" });
            }

            res.json({ status: "success", data: results[0] });
        }
    );
});

app.post("/api/subjects", (req, res) => {
    const { subject_code, subject_name } = req.body;

    if (!subject_code || !subject_name) {
        return res.status(400).json({
            status: "error",
            message: "subject_code and subject_name are required"
        });
    }

    db.query(
        "INSERT INTO subjects (subject_code, subject_name) VALUES (?, ?)",
        [subject_code, subject_name],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Subject added successfully", subject_id: result.insertId });
        }
    );
});

app.put("/api/subjects/:id", (req, res) => {
    const subjectId = req.params.id;
    const { subject_code, subject_name } = req.body;

    if (!subject_code || !subject_name) {
        return res.status(400).json({
            status: "error",
            message: "subject_code and subject_name are required"
        });
    }

    db.query(
        "UPDATE subjects SET subject_code = ?, subject_name = ? WHERE subject_id = ?",
        [subject_code, subject_name, subjectId],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (result.affectedRows === 0) {
                return res.status(404).json({ status: "error", message: "Subject not found" });
            }

            res.json({ status: "success", message: "Subject updated successfully" });
        }
    );
});

app.delete("/api/subjects/:id", (req, res) => {
    const subjectId = req.params.id;

    db.query("SELECT schedule_id FROM schedules WHERE subject_id = ? LIMIT 1", [subjectId], (checkErr, scheduleResults) => {
        if (checkErr) return res.status(500).json({ status: "error", message: checkErr.message });

        if (scheduleResults.length > 0) {
            return res.status(409).json({
                status: "error",
                message: "Cannot delete this subject because it is assigned to one or more schedules. Reassign or delete those schedules first."
            });
        }

        db.query("DELETE FROM subjects WHERE subject_id = ?", [subjectId], (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (result.affectedRows === 0) {
                return res.status(404).json({ status: "error", message: "Subject not found" });
            }

            res.json({ status: "success", message: "Subject deleted successfully" });
        });
    });
});
// =========================
// BUS API
// =========================
app.get("/api/bus-routes", (req, res) => {
    db.query("SELECT route_id, route_name, route_fees, created_at FROM bus_routes ORDER BY route_id ASC", (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/bus-routes", (req, res) => {
    const { route_name, route_fees } = req.body;

    if (!route_name || route_fees === undefined || route_fees === null || route_fees === "") {
        return res.status(400).json({ status: "error", message: "route_name and route_fees are required" });
    }

    db.query(
        "INSERT INTO bus_routes (route_name, route_fees) VALUES (?, ?)",
        [route_name, route_fees],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Bus route added successfully", route_id: result.insertId });
        }
    );
});

app.get("/api/buses", (req, res) => {
    const query = `
        SELECT buses.bus_id, buses.route_id, bus_routes.route_name, bus_routes.route_fees,
               buses.bus_code, buses.meet_at, buses.driver_name, buses.supervisor_name,
               buses.supervisor_phone_number, buses.seats_capacity, buses.seats_left,
               buses.time_move, buses.time_arrive, buses.created_at
        FROM buses
        JOIN bus_routes ON buses.route_id = bus_routes.route_id
        ORDER BY bus_routes.route_id ASC, buses.time_move ASC, buses.time_arrive ASC, buses.seats_left DESC, buses.bus_code ASC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/buses", (req, res) => {
    const {
        route_id,
        bus_code,
        meet_at,
        driver_name,
        supervisor_name,
        supervisor_phone_number,
        seats_capacity,
        seats_left,
        time_move,
        time_arrive
    } = req.body;

    if (!route_id || !bus_code || !meet_at || !driver_name || !supervisor_name || !supervisor_phone_number || !seats_capacity || !time_move || !time_arrive) {
        return res.status(400).json({ status: "error", message: "route_id, bus_code, meet_at, driver_name, supervisor_name, supervisor_phone_number, seats_capacity, time_move, and time_arrive are required" });
    }

    const seatsLeftValue = seats_left === undefined || seats_left === null || seats_left === "" ? seats_capacity : seats_left;

    db.query(
        `INSERT INTO buses (route_id, bus_code, meet_at, driver_name, supervisor_name, supervisor_phone_number, seats_capacity, seats_left, time_move, time_arrive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [route_id, bus_code, meet_at, driver_name, supervisor_name, supervisor_phone_number, seats_capacity, seatsLeftValue, time_move, time_arrive],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Bus added successfully", bus_id: result.insertId });
        }
    );
});

app.get("/api/bus-registrations", (req, res) => {
    const studentId = req.query.student_id;
    let query = `
        SELECT bus_registrations.registration_id, bus_registrations.bus_id, bus_registrations.student_id,
               bus_registrations.registered_at, students.student_number,
               CONCAT(students.first_name, ' ', students.last_name) AS student_name,
               buses.bus_code, bus_routes.route_name
        FROM bus_registrations
        JOIN students ON bus_registrations.student_id = students.student_id
        JOIN buses ON bus_registrations.bus_id = buses.bus_id
        JOIN bus_routes ON buses.route_id = bus_routes.route_id
    `;
    const params = [];

    if (studentId) {
        query += " WHERE bus_registrations.student_id = ?";
        params.push(studentId);
    }

    query += " ORDER BY bus_registrations.registration_id ASC";

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/bus-registrations", (req, res) => {
    const { bus_id, student_id } = req.body;

    if (!bus_id || !student_id) {
        return res.status(400).json({ status: "error", message: "bus_id and student_id are required" });
    }

    db.beginTransaction((transactionErr) => {
        if (transactionErr) return res.status(500).json({ status: "error", message: transactionErr.message });

        db.query("SELECT registration_id, bus_id FROM bus_registrations WHERE student_id = ? FOR UPDATE", [student_id], (registrationErr, registrations) => {
            if (registrationErr) return db.rollback(() => res.status(500).json({ status: "error", message: registrationErr.message }));

            const existingRegistration = registrations.length > 0 ? registrations[0] : null;

            if (existingRegistration && String(existingRegistration.bus_id) === String(bus_id)) {
                return db.commit((commitErr) => {
                    if (commitErr) return db.rollback(() => res.status(500).json({ status: "error", message: commitErr.message }));
                    res.json({ status: "success", message: "Student is already registered in this bus" });
                });
            }

            db.query("SELECT bus_id, seats_left FROM buses WHERE bus_id = ? FOR UPDATE", [bus_id], (busErr, busesResult) => {
                if (busErr) return db.rollback(() => res.status(500).json({ status: "error", message: busErr.message }));

                if (busesResult.length === 0) {
                    return db.rollback(() => res.status(404).json({ status: "error", message: "Bus not found" }));
                }

                if (busesResult[0].seats_left <= 0) {
                    return db.rollback(() => res.status(400).json({ status: "error", message: "Selected bus is already full" }));
                }

                const afterPreviousBusUpdate = () => {
                    db.query("UPDATE buses SET seats_left = seats_left - 1 WHERE bus_id = ?", [bus_id], (seatErr) => {
                        if (seatErr) return db.rollback(() => res.status(500).json({ status: "error", message: seatErr.message }));

                        const saveRegistration = existingRegistration
                            ? ["UPDATE bus_registrations SET bus_id = ?, registered_at = CURRENT_TIMESTAMP WHERE student_id = ?", [bus_id, student_id]]
                            : ["INSERT INTO bus_registrations (bus_id, student_id) VALUES (?, ?)", [bus_id, student_id]];

                        db.query(saveRegistration[0], saveRegistration[1], (saveErr) => {
                            if (saveErr) return db.rollback(() => res.status(500).json({ status: "error", message: saveErr.message }));

                            db.commit((commitErr) => {
                                if (commitErr) return db.rollback(() => res.status(500).json({ status: "error", message: commitErr.message }));
                                res.json({ status: "success", message: existingRegistration ? "Bus registration updated successfully" : "Bus registration added successfully" });
                            });
                        });
                    });
                };

                if (existingRegistration) {
                    db.query("UPDATE buses SET seats_left = seats_left + 1 WHERE bus_id = ?", [existingRegistration.bus_id], (previousSeatErr) => {
                        if (previousSeatErr) return db.rollback(() => res.status(500).json({ status: "error", message: previousSeatErr.message }));
                        afterPreviousBusUpdate();
                    });
                } else {
                    afterPreviousBusUpdate();
                }
            });
        });
    });
});

app.delete("/api/bus-registrations/student/:student_id", (req, res) => {
    const studentId = req.params.student_id;

    db.beginTransaction((transactionErr) => {
        if (transactionErr) return res.status(500).json({ status: "error", message: transactionErr.message });

        db.query("SELECT registration_id, bus_id FROM bus_registrations WHERE student_id = ? FOR UPDATE", [studentId], (registrationErr, registrations) => {
            if (registrationErr) return db.rollback(() => res.status(500).json({ status: "error", message: registrationErr.message }));

            if (registrations.length === 0) {
                return db.rollback(() => res.status(404).json({ status: "error", message: "Bus registration not found" }));
            }

            const busId = registrations[0].bus_id;

            db.query("DELETE FROM bus_registrations WHERE student_id = ?", [studentId], (deleteErr) => {
                if (deleteErr) return db.rollback(() => res.status(500).json({ status: "error", message: deleteErr.message }));

                db.query("UPDATE buses SET seats_left = seats_left + 1 WHERE bus_id = ?", [busId], (seatErr) => {
                    if (seatErr) return db.rollback(() => res.status(500).json({ status: "error", message: seatErr.message }));

                    db.commit((commitErr) => {
                        if (commitErr) return db.rollback(() => res.status(500).json({ status: "error", message: commitErr.message }));
                        res.json({ status: "success", message: "Bus registration cancelled successfully" });
                    });
                });
            });
        });
    });
});
// =========================
// LIGHTWEIGHT PORTAL API
// =========================
app.get("/api/system-messages", (req, res) => {
    db.query("SELECT message_id, message_type, message_content, created_at FROM system_messages ORDER BY message_id DESC", (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/system-messages", (req, res) => {
    const { message_type, message_content } = req.body;

    if (!message_type || !message_content) {
        return res.status(400).json({ status: "error", message: "message_type and message_content are required" });
    }

    db.query(
        "INSERT INTO system_messages (message_type, message_content) VALUES (?, ?)",
        [message_type, message_content],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "System message added successfully", message_id: result.insertId });
        }
    );
});

app.get("/api/about-us", (req, res) => {
    db.query("SELECT setting_value AS html_data, updated_at FROM portal_settings WHERE setting_key = 'about_us' LIMIT 1", (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results.length > 0 ? results[0] : { html_data: "", updated_at: null } });
    });
});

app.put("/api/about-us", (req, res) => {
    const { html_data } = req.body;

    if (html_data === undefined || html_data === null) {
        return res.status(400).json({ status: "error", message: "html_data is required" });
    }

    db.query(
        `INSERT INTO portal_settings (setting_key, setting_value) VALUES ('about_us', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
        [html_data],
        (err) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "About Us updated successfully" });
        }
    );
});

app.get("/api/qr-link", (req, res) => {
    db.query("SELECT setting_value AS qr_link, updated_at FROM portal_settings WHERE setting_key = 'qr_link' LIMIT 1", (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results.length > 0 ? results[0] : { qr_link: "", updated_at: null } });
    });
});

app.put("/api/qr-link", (req, res) => {
    const { qr_link } = req.body;

    if (!qr_link) {
        return res.status(400).json({ status: "error", message: "qr_link is required" });
    }

    db.query(
        `INSERT INTO portal_settings (setting_key, setting_value) VALUES ('qr_link', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
        [qr_link],
        (err) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "QR link updated successfully" });
        }
    );
});

app.get("/api/reports/summary", (req, res) => {
    const query = `
        SELECT
            (SELECT COUNT(*) FROM students) AS total_students,
            (SELECT COUNT(*) FROM teachers) AS total_lecturers,
            (SELECT COUNT(*) FROM courses) AS total_courses,
            (SELECT COUNT(*) FROM events) AS total_events,
            (SELECT COUNT(*) FROM attendance) AS total_attendance,
            (SELECT COUNT(*) FROM student_grades) AS total_grade_records,
            (SELECT COUNT(*) FROM bills) AS total_bills,
            (SELECT COUNT(*) FROM buses) AS total_buses,
            (SELECT COUNT(*) FROM bus_registrations) AS total_bus_registrations,
            (SELECT COUNT(*) FROM system_messages) AS total_system_messages
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results[0] });
    });
});
// =========================
// GRADES API
// =========================
app.get("/api/grade-categories", (req, res) => {
    db.query("SELECT category_id, category_name, max_score, display_order FROM grade_categories ORDER BY display_order ASC, category_id ASC", (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.post("/api/grade-categories", (req, res) => {
    const { category_name, max_score, display_order } = req.body;

    if (!category_name || max_score === undefined || max_score === null || max_score === "") {
        return res.status(400).json({ status: "error", message: "category_name and max_score are required" });
    }

    db.query(
        "INSERT INTO grade_categories (category_name, max_score, display_order) VALUES (?, ?, ?)",
        [String(category_name).toLowerCase(), max_score, display_order || 0],
        (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Grade category added successfully", category_id: result.insertId });
        }
    );
});

app.delete("/api/grade-categories/:id", (req, res) => {
    const categoryId = req.params.id;

    db.query("SELECT COUNT(*) AS used_count FROM student_grades WHERE category_id = ?", [categoryId], (countErr, countResult) => {
        if (countErr) return res.status(500).json({ status: "error", message: countErr.message });

        if (countResult[0].used_count > 0) {
            return res.status(400).json({ status: "error", message: "This grade category is used by student grade records and cannot be deleted" });
        }

        db.query("DELETE FROM grade_categories WHERE category_id = ?", [categoryId], (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (result.affectedRows === 0) {
                return res.status(404).json({ status: "error", message: "Grade category not found" });
            }

            res.json({ status: "success", message: "Grade category deleted successfully" });
        });
    });
});

app.get("/api/grades", (req, res) => {
    const query = `
        SELECT student_grades.grade_id, student_grades.student_id,
               CONCAT(students.first_name, ' ', students.last_name) AS student_name,
               student_grades.subject_id, student_grades.course_id,
               COALESCE(subjects.subject_code, courses.course_code) AS subject_code,
               COALESCE(subjects.subject_name, courses.course_name) AS subject_name,
               student_grades.category_id, grade_categories.category_name, grade_categories.max_score,
               student_grades.teacher_id, teachers.teacher_name,
               student_grades.grade_score, student_grades.remarks,
               student_grades.created_at, student_grades.updated_at
        FROM student_grades
        JOIN students ON student_grades.student_id = students.student_id
        LEFT JOIN subjects ON student_grades.subject_id = subjects.subject_id
        LEFT JOIN courses ON student_grades.course_id = courses.course_id
        JOIN grade_categories ON student_grades.category_id = grade_categories.category_id
        LEFT JOIN teachers ON student_grades.teacher_id = teachers.teacher_id
        ORDER BY student_grades.student_id ASC, subject_name ASC, grade_categories.display_order ASC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

app.get("/api/grades/student/:student_id", (req, res) => {
    const studentId = req.params.student_id;

    const query = `
        SELECT student_grades.subject_id, student_grades.course_id,
               COALESCE(subjects.subject_code, courses.course_code) AS subject_code,
               COALESCE(subjects.subject_name, courses.course_name) AS subject_name,
               student_grades.grade_id, grade_categories.category_id,
               grade_categories.category_name, grade_categories.max_score,
               grade_categories.display_order, student_grades.grade_score,
               student_grades.teacher_id, teachers.teacher_name,
               student_grades.remarks, student_grades.updated_at
        FROM student_grades
        LEFT JOIN subjects ON student_grades.subject_id = subjects.subject_id
        LEFT JOIN courses ON student_grades.course_id = courses.course_id
        JOIN grade_categories ON student_grades.category_id = grade_categories.category_id
        LEFT JOIN teachers ON student_grades.teacher_id = teachers.teacher_id
        WHERE student_grades.student_id = ?
        ORDER BY subject_name ASC, grade_categories.display_order ASC, grade_categories.category_id ASC
    `;

    db.query(query, [studentId], (err, rows) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        const subjectsMap = new Map();

        rows.forEach((row) => {
            const gradeGroupId = row.course_id ? `course-${row.course_id}` : `subject-${row.subject_id}`;

            if (!subjectsMap.has(gradeGroupId)) {
                subjectsMap.set(gradeGroupId, {
                    subject_id: row.subject_id || row.course_id,
                    course_id: row.course_id,
                    subject_code: row.subject_code,
                    subject_name: row.subject_name,
                    grades: [],
                    total_score: 0,
                    total_possible: 0
                });
            }

            const subject = subjectsMap.get(gradeGroupId);
            const score = Number(row.grade_score || 0);
            const maxScore = Number(row.max_score || 0);

            subject.grades.push({
                grade_id: row.grade_id,
                category_id: row.category_id,
                category_name: row.category_name,
                max_score: row.max_score,
                grade_score: row.grade_score,
                teacher_id: row.teacher_id,
                teacher_name: row.teacher_name,
                remarks: row.remarks,
                updated_at: row.updated_at
            });
            subject.total_score += score;
            subject.total_possible += maxScore;
        });

        res.json({ status: "success", data: Array.from(subjectsMap.values()) });
    });
});

app.post("/api/grades", (req, res) => {
    const { student_id, subject_id, course_id, category_id, teacher_id, grade_score, remarks } = req.body;

    if (!student_id || (!subject_id && !course_id) || !category_id || grade_score === undefined || grade_score === null || grade_score === "") {
        return res.status(400).json({ status: "error", message: "student_id, subject_id or course_id, category_id, and grade_score are required" });
    }

    db.query("SELECT max_score FROM grade_categories WHERE category_id = ?", [category_id], (categoryErr, categories) => {
        if (categoryErr) return res.status(500).json({ status: "error", message: categoryErr.message });

        if (categories.length === 0) {
            return res.status(404).json({ status: "error", message: "Grade category not found" });
        }

        if (Number(grade_score) < 0 || Number(grade_score) > Number(categories[0].max_score)) {
            return res.status(400).json({ status: "error", message: "grade_score must be within the category max_score" });
        }

        const normalizedSubjectId = subject_id || null;
        const normalizedCourseId = course_id || null;
        const query = `
            INSERT INTO student_grades (student_id, subject_id, course_id, category_id, teacher_id, grade_score, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE teacher_id = VALUES(teacher_id), grade_score = VALUES(grade_score), remarks = VALUES(remarks), updated_at = CURRENT_TIMESTAMP
        `;

        db.query(query, [student_id, normalizedSubjectId, normalizedCourseId, category_id, teacher_id || null, grade_score, remarks || null], (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });
            res.json({ status: "success", message: "Grade saved successfully", grade_id: result.insertId });
        });
    });
});

app.put("/api/grades/:id", (req, res) => {
    const gradeId = req.params.id;
    const { category_id, teacher_id, grade_score, remarks } = req.body;

    if (!category_id || grade_score === undefined || grade_score === null || grade_score === "") {
        return res.status(400).json({ status: "error", message: "category_id and grade_score are required" });
    }

    db.query("SELECT max_score FROM grade_categories WHERE category_id = ?", [category_id], (categoryErr, categories) => {
        if (categoryErr) return res.status(500).json({ status: "error", message: categoryErr.message });

        if (categories.length === 0) {
            return res.status(404).json({ status: "error", message: "Grade category not found" });
        }

        if (Number(grade_score) < 0 || Number(grade_score) > Number(categories[0].max_score)) {
            return res.status(400).json({ status: "error", message: "grade_score must be within the category max_score" });
        }

        db.query(
            "UPDATE student_grades SET category_id = ?, teacher_id = ?, grade_score = ?, remarks = ? WHERE grade_id = ?",
            [category_id, teacher_id || null, grade_score, remarks || null, gradeId],
            (err, result) => {
                if (err) return res.status(500).json({ status: "error", message: err.message });

                if (result.affectedRows === 0) {
                    return res.status(404).json({ status: "error", message: "Grade not found" });
                }

                res.json({ status: "success", message: "Grade updated successfully" });
            }
        );
    });
});

app.delete("/api/grades/:id", (req, res) => {
    const gradeId = req.params.id;

    db.query("DELETE FROM student_grades WHERE grade_id = ?", [gradeId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Grade not found" });
        }

        res.json({ status: "success", message: "Grade deleted successfully" });
    });
});// =========================
// COURSES API
// =========================

// GET all courses
app.get("/api/courses", (req, res) => {
    const query = `
        SELECT 
            courses.course_id,
            courses.teacher_id,
            courses.course_code,
            courses.course_name,
            teachers.teacher_name AS lecturer
        FROM courses
        LEFT JOIN teachers ON courses.teacher_id = teachers.teacher_id
        ORDER BY courses.course_id ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                message: err.message
            });
        }

        res.json({
            status: "success",
            data: results
        });
    });
});

// POST course
app.post("/api/courses", (req, res) => {
    const { course_code, course_name, teacher_id } = req.body;

    if (!course_code || !course_name || !teacher_id) {
        return res.status(400).json({
            status: "error",
            message: "course_code, course_name, and teacher_id are required"
        });
    }

    const query = `
        INSERT INTO courses (course_code, course_name, teacher_id)
        VALUES (?, ?, ?)
    `;

    db.query(query, [course_code, course_name, teacher_id], (err, result) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                message: err.message
            });
        }

        res.json({
            status: "success",
            message: "Course added successfully",
            course_id: result.insertId
        });
    });
});

// UPDATE course
app.put("/api/courses/:id", (req, res) => {
    const courseId = req.params.id;
    const { course_code, course_name, teacher_id } = req.body;

    if (!course_code || !course_name || !teacher_id) {
        return res.status(400).json({
            status: "error",
            message: "course_code, course_name, and teacher_id are required"
        });
    }

    const query = `
        UPDATE courses
        SET course_code = ?, course_name = ?, teacher_id = ?
        WHERE course_id = ?
    `;

    db.query(query, [course_code, course_name, teacher_id, courseId], (err, result) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                message: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "error",
                message: "Course not found"
            });
        }

        res.json({
            status: "success",
            message: "Course updated successfully"
        });
    });
});

// DELETE course
app.delete("/api/courses/:id", (req, res) => {
    const id = req.params.id;

    db.query("DELETE FROM courses WHERE course_id = ?", [id], (err) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        res.json({ status: "success", message: "Course deleted" });
    });
});

// =========================
// LECTURERS API
// =========================
app.get("/api/lecturers", (req, res) => {
    const query = `
        SELECT 
            teacher_id,
            teacher_name,
            email,
            contact_number
        FROM teachers
        ORDER BY teacher_name ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                message: err.message
            });
        }

        res.json({
            status: "success",
            data: results
        });
    });
});
// POST lecturer
app.post("/api/lecturers", (req, res) => {
    const { teacher_name, email, contact_number } = req.body;

    if (!teacher_name) {
        return res.status(400).json({
            status: "error",
            message: "teacher_name is required"
        });
    }

    const query = `
        INSERT INTO teachers (teacher_name, email, contact_number)
        VALUES (?, ?, ?)
    `;

    db.query(query, [teacher_name, email || null, contact_number || null], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        res.json({
            status: "success",
            message: "Lecturer added successfully",
            teacher_id: result.insertId
        });
    });
});

// UPDATE lecturer
app.put("/api/lecturers/:id", (req, res) => {
    const teacherId = req.params.id;
    const { teacher_name, email, contact_number } = req.body;

    if (!teacher_name) {
        return res.status(400).json({
            status: "error",
            message: "teacher_name is required"
        });
    }

    const query = `
        UPDATE teachers
        SET teacher_name = ?, email = ?, contact_number = ?
        WHERE teacher_id = ?
    `;

    db.query(query, [teacher_name, email || null, contact_number || null, teacherId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: "error", message: "Lecturer not found" });
        }

        res.json({ status: "success", message: "Lecturer updated successfully" });
    });
});

// DELETE lecturer
app.delete("/api/lecturers/:id", (req, res) => {
    const teacherId = req.params.id;

    db.query("SELECT course_id FROM courses WHERE teacher_id = ? LIMIT 1", [teacherId], (checkErr, courseResults) => {
        if (checkErr) return res.status(500).json({ status: "error", message: checkErr.message });

        if (courseResults.length > 0) {
            return res.status(409).json({
                status: "error",
                message: "Cannot delete this lecturer because they are assigned to one or more courses. Reassign or delete those courses first."
            });
        }

        db.query("DELETE FROM teachers WHERE teacher_id = ?", [teacherId], (err, result) => {
            if (err) return res.status(500).json({ status: "error", message: err.message });

            if (result.affectedRows === 0) {
                return res.status(404).json({ status: "error", message: "Lecturer not found" });
            }

            res.json({ status: "success", message: "Lecturer deleted successfully" });
        });
    });
});

// =========================
// USERS API
// =========================

// GET all users
app.get("/api/users", (req, res) => {
    const query = `
        SELECT
            user_id,
            full_name,
            username,
            role,
            student_id,
            teacher_id
        FROM users
        ORDER BY role ASC, user_id ASC
    `;

    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });
        res.json({ status: "success", data: results });
    });
});

// POST add user
app.post("/api/users", (req, res) => {
    const { full_name, username, password, role, student_id, teacher_id } = req.body;

    if (!full_name || !username || !password || !role) {
        return res.status(400).json({
            status: "error",
            message: "full_name, username, password, and role are required"
        });
    }

    const linkedStudentId = role === "Student" ? (student_id || null) : null;
    const linkedTeacherId = role === "Lecturer" ? (teacher_id || null) : null;

    if (role === "Student" && !linkedStudentId) {
        return res.status(400).json({ status: "error", message: "Student users must be linked to a student record" });
    }

    if (role === "Lecturer" && !linkedTeacherId) {
        return res.status(400).json({ status: "error", message: "Lecturer users must be linked to a lecturer record" });
    }

    const query = `
        INSERT INTO users (full_name, username, password, role, student_id, teacher_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [full_name, username, password, role, linkedStudentId, linkedTeacherId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        res.json({
            status: "success",
            message: "User added successfully",
            user_id: result.insertId
        });
    });
});

// PUT update user
app.put("/api/users/:id", (req, res) => {
    const userId = req.params.id;
    const { full_name, username, password, role, student_id, teacher_id } = req.body;

    if (!full_name || !username || !role) {
        return res.status(400).json({
            status: "error",
            message: "full_name, username, and role are required"
        });
    }

    const linkedStudentId = role === "Student" ? (student_id || null) : null;
    const linkedTeacherId = role === "Lecturer" ? (teacher_id || null) : null;

    if (role === "Student" && !linkedStudentId) {
        return res.status(400).json({ status: "error", message: "Student users must be linked to a student record" });
    }

    if (role === "Lecturer" && !linkedTeacherId) {
        return res.status(400).json({ status: "error", message: "Lecturer users must be linked to a lecturer record" });
    }

    const query = `
        UPDATE users
        SET full_name = ?, username = ?, password = COALESCE(NULLIF(?, ''), password), role = ?, student_id = ?, teacher_id = ?
        WHERE user_id = ?
    `;

    db.query(query, [full_name, username, password || '', role, linkedStudentId, linkedTeacherId, userId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "error",
                message: "User not found"
            });
        }

        res.json({
            status: "success",
            message: "User updated successfully"
        });
    });
});

// DELETE user
app.delete("/api/users/:id", (req, res) => {
    const userId = req.params.id;

    db.query("DELETE FROM users WHERE user_id = ?", [userId], (err, result) => {
        if (err) return res.status(500).json({ status: "error", message: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "error",
                message: "User not found"
            });
        }

        res.json({
            status: "success",
            message: "User deleted successfully"
        });
    });
});

// =========================
// LOGIN API (PROFESSIONAL)
// =========================
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            status: "error",
            message: "Username and password are required"
        });
    }

    const query = `
        SELECT 
            user_id,
            full_name,
            username,
            role,
            student_id,
            teacher_id
        FROM users
        WHERE username = ? AND password = ?
        LIMIT 1
    `;

    db.query(query, [username, password], (err, results) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                message: err.message
            });
        }

        if (results.length === 0) {
            return res.status(401).json({
                status: "error",
                message: "Invalid username or password"
            });
        }

        const user = results[0];

        res.json({
            status: "success",
            message: "Login successful",
            user: {
                user_id: user.user_id,
                full_name: user.full_name,
                username: user.username,
                role: user.role,
                student_id: user.student_id,
                teacher_id: user.teacher_id
            }
        });
    });
});

// GET attendance by lecturer
app.get("/api/attendance/lecturer/:teacher_id", (req, res) => {
    const teacherId = req.params.teacher_id;

    const query = `
        SELECT 
            attendance.attendance_id,
            attendance.student_id,
            students.student_number,
            CONCAT(students.first_name, ' ', students.last_name) AS student_name,
            attendance.event_id,
            events.event_name,
            COALESCE(event_courses.course_code, student_courses.course_code) AS subject_code,
            COALESCE(event_courses.course_name, student_courses.course_name) AS subject_name,
            teachers.teacher_name,
            attendance.attendance_date,
            attendance.status,
            attendance.time_in,
            attendance.remarks
        FROM attendance
        JOIN students ON attendance.student_id = students.student_id
        LEFT JOIN events ON attendance.event_id = events.event_id
        LEFT JOIN courses event_courses ON events.course_id = event_courses.course_id
        LEFT JOIN courses student_courses ON students.course_id = student_courses.course_id
        LEFT JOIN teachers ON teachers.teacher_id = COALESCE(attendance.teacher_id, event_courses.teacher_id, student_courses.teacher_id)
        WHERE COALESCE(attendance.teacher_id, event_courses.teacher_id, student_courses.teacher_id) = ?
        ORDER BY attendance.attendance_id DESC
    `;

    db.query(query, [teacherId], (err, results) => {
        if (err) {
            return res.status(500).json({
                status: "error",
                message: err.message
            });
        }

        res.json({
            status: "success",
            data: results
        });
    });
});

// START SERVER
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
























