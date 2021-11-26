const functions = require('firebase-functions')

const express = require('express')

const app = express()

const { getAllPosts, postOne, getPost, commentOnPost, likePost, unlikePost, deletePost } = require('./handlers/posts')

const { signup, login, uploadImage, addUserDetails, getAuthenticatedUser, getUserDetails, markNotificationsRead } = require('./handlers/users')

const cors = require('cors')
app.use(cors())


const FBAuth = require('./utility/FBAuth')

const { db } = require('./utility/admin')

// Post Route: Get all posts
app.get('/posts', getAllPosts)
// Post Route: Post one post
app.post('/post', FBAuth, postOne)
// get one post
app.get('/post/:postId', getPost)

// delete post
app.delete('/post/:postId', FBAuth, deletePost)
// like post
app.get('/post/:postId/like', FBAuth, likePost)
// unlike post
app.get('/post/:postId/unlike', FBAuth, unlikePost)
// comment on post
app.post('/post/:postId/comment', FBAuth, commentOnPost)

// signup and login route
app.post('/signup', signup)
app.post('/login', login)
// upload Profile Image
app.post('/user/image', FBAuth, uploadImage)
// add other details
app.post('/user', FBAuth, addUserDetails)
// get own user details
app.get('/user', FBAuth, getAuthenticatedUser)
app.get('/user/:userName', getUserDetails)
app.post('/notifications', FBAuth, markNotificationsRead)


exports.api = functions.region('europe-west1').https.onRequest(app)

exports.createNotificationOnLike = functions.region('europe-west1').firestore.document('likes/{id}')
    .onCreate((snapshot) => {
        return db.doc(`/posts/${snapshot.data().postId}`).get()
            .then(doc => {
                if (doc.exists && doc.data().userName !== snapshot.data().userName) {
                    return db.doc(`/notifications/${snapshot.id}`).set({
                        createdAt: new Date().toISOString(),
                        recipient: doc.data().userName,
                        sender: snapshot.data().userName,
                        type: 'like',
                        read: false,
                        postId: doc.id
                    })
                }
            })
            .catch(err => {
                console.error(err)
                return
            })
    })

exports.deleteNotificationOnUnlike = functions.region('europe-west1').firestore.document('likes/{id}')
    .onDelete((snapshot) => {
        return db.doc(`/notifications/${snapshot.id}`)
            .delete()

            .catch(err => {
                console.error(err)

            })
    })

exports.createNotificationOnCommment = functions.region('europe-west1').firestore.document('comments/{id}')
    .onCreate((snapshot) => {
        return db.doc(`/posts/${snapshot.data().postId}`).get()
            .then(doc => {
                if (doc.exists && doc.data().userName !== snapshot.data().userName) {
                    return db.doc(`/notifications/${snapshot.id}`).set({
                        createdAt: new Date().toISOString(),
                        recipient: doc.data().userName,
                        sender: snapshot.data().userName,
                        type: 'comment',
                        read: false,
                        postId: doc.id
                    })
                }
            })
            .catch(err => {
                console.error(err)
            })
    })

exports.onUserImageChange = functions.region('europe-west1').firestore.document('/users/{userId}').onUpdate(change => {
    if (change.before.data().imageUrl !== change.after.data().imageUrl) {
        let batch = db.batch()
        return db.collection(`posts`).where('userName', '==', change.before.data().userName).get()
            .then(data => {
                data.forEach(doc => {
                    const post = db.doc(`/posts/${doc.id}`)
                    batch.update(post, { imageUrl: change.after.data().imageUrl })
                })
                return batch.commit()
            })
    } else {
        return true
    }
})

exports.onPostDelete = functions.region('europe-west1').firestore.document('/posts/{postId}').onDelete((snapshot, context) => {
    const postId = contextt.params.postId;
    const batch = db.batch()
    return db.collection('comments').where('postId', '==', postId).get()
        .then(data => {
            data.forEach(doc => {
                batch.delete(db.doc(`/comments/${doc.id}`))
            })
            return db.collection('likes').where('postId', '==', postId).get()
        })
        .then(data => {
            data.forEach(doc => {
                batch.delete(db.doc(`/likes/${doc.id}`))
            })
            return db.collection('notifications').where('postId', '==', postId).get()
        })
        .then(data => {
            data.forEach(doc => {
                batch.delete(db.doc(`/notifications/${doc.id}`))
            })
            return batch.commit()
        })
        .catch(err => console.error(err))
})