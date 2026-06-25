const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const prisma = require('./prisma');

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails[0].value;
                const google_id = profile.id;
                const first_name = profile.name.givenName;
                const last_name = profile.name.familyName;

                let user = await prisma.user.findUnique({ where: { google_id } });

                if (!user) {
                    // check if email already exists (registered manually)
                    user = await prisma.user.findUnique({ where: { email } });

                    if (user) {
                        // link google to existing account
                        user = await prisma.user.update({
                            where: { email },
                            data: { google_id, is_verified: true }
                        });
                    } else {
                        // create new user via Google
                        user = await prisma.user.create({
                            data: { first_name, last_name, email, google_id, is_verified: true }
                        });
                    }
                }

                return done(null, user);
            } catch (err) {
                return done(err, null);
            }
        }
    )
);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
});

module.exports = passport;