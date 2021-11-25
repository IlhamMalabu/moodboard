const { db, admin } = require('../utility/admin')

const config = require('../utility/config')

const { initializeApp } = require('firebase/app')
initializeApp(config);

const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth')
const auth = getAuth()

const { validateSignupData, validateLoginData, reduceUserDetails } = require('../utility/validators');
const { UserRecordMetadata } = require('firebase-functions/v1/auth');

exports.signup = (req, res) => {
    let token, userId
    const newUser = {
        email: req.body.email,
        password: req.body.password,
        confirmPassword: req.body.confirmPassword,
        userName: req.body.userName,
    }

    const { valid, errors } = validateSignupData(newUser)

    if (!valid) return res.status(400).json(errors)

    const noImg = 'default-img.png'
    // validation: make sure user is unique
    db.doc(`/users/${newUser.userName}`).get()
        .then(doc => {
            if (doc.exists) {
                return res.status(400).json({ message: "This username already exists" })
            } else {
                return createUserWithEmailAndPassword(auth, newUser.email, newUser.password)
            }
        })
        .then((data) => {
            userId = data.user.uid
            return data.user.getIdToken();
        })
        .then((idToken) => {
            token = idToken;
            const userCredentials = {
                userName: newUser.userName,
                email: newUser.email,
                createdAt: new Date().toISOString(),
                imageUrl: `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${noImg}?alt=media`,
                userId
            };
            return db.doc(`/users/${newUser.userName}`).set(userCredentials)
        })
        .then(() => {
            return res.status(201).json({ token });
        })
        .catch(err => {
            console.error(err)
            if (err.code === 'auth/email-already-in-use') {
                return res.status(400).json({ email: 'Email is already in use' })
            } else {
                return res.status(500).json({ general: "Something went wrong. Please try again" });
            }
        })
}

exports.login = (req, res) => {
    const user = {
        email: req.body.email,
        password: req.body.password
    };
    const { valid, errors } = validateLoginData(user)


    if (!valid) return res.status(400).json(errors)

    signInWithEmailAndPassword(auth, user.email, user.password)
        .then(data => {
            return data.user.getIdToken()
        })
        .then(token => {
            return res.json({ token })
        })
        .catch(err => {
            console.error(err)
            return res.status(403).json({ general: "Wrong credentials, please try again" })
        })

}
// Add user details
exports.addUserDetails = (req, res) => {
    let userDetails = reduceUserDetails(req.body)

    db.doc(`/users/${req.user.userName}`).update(userDetails)
        .then(() => {
            return res.json({ message: 'Details added successfully' });
        })
        .catch((err) => {
            console.error(err)
            return res.status(500).json({ error: err.code })
        })
}

// Get any users details
exports.getUserDetails = (req, res) => {
    let userData = {};
    db.doc(`/users/${req.params.userName}`).get()
        .then(doc => {
            if (doc.exists) {
                userData.user = doc.data()
                return db.collection(`posts`).where('userName', '==', req.params.userName)
                    .orderBy('createdAt', 'desc')
                    .get()
            } else {
                return res.status(404).json({ error: 'User not found' })
            }
        })
        .then(data => {
            userData.posts = [];
            data.forEach((doc) => {
                userData.posts.push({
                    body: doc.data().body,
                    createdAt: doc.data().createdAt,
                    userName: doc.data().userName,
                    userImage: doc.data().imageUrl,
                    likeCount: doc.data().likeCount,
                    commentCount: doc.data().commentCount,
                    postId: doc.id
                })
            })
            return res.json(userData)
        })
        .catch(err => {
            console.error(err)
            return res.status(500).json({ error: err.code })
        })
}


// Get own user details
exports.getAuthenticatedUser = (req, res) => {
    let userData = {}
    db.doc(`/users/${req.user.userName}`).get()
        .then(doc => {
            if (doc.exists) {
                userData.credentials = doc.data()
                return db.collection('likes')
                    .where('userName', '==', req.user.userName).get()
            }

        })
        .then(data => {
            userData.likes = []
            data.forEach(doc => {
                userData.likes.push(doc.data());
            })
            return db.collection('notifications').where('recipient', '==', req.user.userName)
                .orderBy('createdAt', 'desc').limit(10).get()
        })
        .then(data => {
            userData.notifications = []
            data.forEach(doc => {
                userData.notifications.push({
                    recipient: doc.data().recipient,
                    sender: doc.data().sender,
                    createdAt: doc.data().createdAt, postId: doc.data().postId,
                    type: doc.data().type,
                    read: doc.data().read,
                    notificationId: doc.id
                })
            })
            return res.json(userData)
        })
        .catch(err => {
            console.error(err)
            return res.status(500).json({ error: err.code })
        })
}

// Upload user profile picture
exports.uploadImage = (req, res) => {
    const BusBoy = require('busboy')
    const path = require('path')
    const os = require('os')
    const fs = require('fs')

    const busboy = new BusBoy({ headers: req.headers })

    let imageFileName;
    let imageToBeUploaded = {};

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {

        if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') {
            return res.status(400).json({ error: 'Wrong file type submitted' })
        }

        const imageExtension = filename.split('.')[filename.split('.').length - 1]

        imageFileName = `${Math.round(Math.random() * 100000)}.${imageExtension}`

        const filepath = path.join(os.tmpdir(), imageFileName)

        imageToBeUploaded = { filepath, mimetype }

        file.pipe(fs.createWriteStream(filepath))
    })
    busboy.on('finish', () => {
        admin.storage().bucket(config.storageBucket).upload(imageToBeUploaded.filepath, {
            resumable: false,
            metadata: {
                metadata: {
                    contentType: imageToBeUploaded.mimetype
                }
            }
        })
            .then(() => {
                const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${imageFileName}?alt=media`

                return db.doc(`/users/${req.user.userName}`).update({ imageUrl: imageUrl });
            })
            .then(() => {
                return res.json({ message: 'Image uploaded successfully' })
            })
            .catch(err => {
                console.error(err)
                return res.status(500).json({ error: err.code })
            })
    })
    busboy.end(req.rawBody)
}

exports.markNotificationsRead = (req, res) => {
    let batch = db.batch()
    req.body.forEach(notificationId => {
        const notification = db.doc(`/notifications/${notificationId}`)
        batch.update(notification, { read: true });
    })
    batch.commit()
        .then(() => {
            return res.json({ message: "Notifications read" })
        })
        .catch(err => {
            console.error(err)
            return res.status(500).json({ error: err.code })
        })
}