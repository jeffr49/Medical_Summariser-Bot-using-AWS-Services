const { CognitoIdentityProviderClient, SignUpCommand, ConfirmSignUpCommand, InitiateAuthCommand, RespondToAuthChallengeCommand, GetUserCommand, GlobalSignOutCommand } = require('@aws-sdk/client-cognito-identity-provider');
const crypto = require('crypto');

const client = new CognitoIdentityProviderClient({
    region: process.env.COGNITO_REGION || 'us-east-1'
});

const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

if (!CLIENT_ID || !USER_POOL_ID) {
    console.warn('Warning: Cognito credentials not configured. Please set COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID, and COGNITO_REGION in .env file');
}

function computeSecretHash(username) {
    if (!CLIENT_SECRET) {
        return undefined;
    }
    return crypto
        .createHmac('SHA256', CLIENT_SECRET)
        .update(username + CLIENT_ID)
        .digest('base64');
}

async function signUp(email, password, attributes = {}) {
    try {
        const params = {
            ClientId: CLIENT_ID,
            Username: email,
            Password: password,
            UserAttributes: Object.entries(attributes).map(([Name, Value]) => ({ Name, Value }))
        };

        const secretHash = computeSecretHash(email);
        if (secretHash) {
            params.SecretHash = secretHash;
        }

        const command = new SignUpCommand(params);
        const response = await client.send(command);
        return {
            success: true,
            userSub: response.UserSub,
            codeDeliveryDetails: response.CodeDeliveryDetails
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

async function confirmSignUp(email, confirmationCode) {
    try {
        const params = {
            ClientId: CLIENT_ID,
            Username: email,
            ConfirmationCode: confirmationCode
        };

        const secretHash = computeSecretHash(email);
        if (secretHash) {
            params.SecretHash = secretHash;
        }

        const command = new ConfirmSignUpCommand(params);
        await client.send(command);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

async function signIn(email, password) {
    try {
        const authParameters = {
            USERNAME: email,
            PASSWORD: password
        };

        const secretHash = computeSecretHash(email);
        if (secretHash) {
            authParameters.SECRET_HASH = secretHash;
        }

        const params = {
            ClientId: CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: authParameters
        };

        const command = new InitiateAuthCommand(params);
        const response = await client.send(command);
        
        if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            return {
                success: false,
                requiresNewPassword: true,
                session: response.Session,
                challengeParameters: response.ChallengeParameters,
                error: 'NEW_PASSWORD_REQUIRED'
            };
        }
        
        if (!response || !response.AuthenticationResult) {
            console.error('Authentication failed: No AuthenticationResult in response', response);
            return {
                success: false,
                error: 'Authentication failed: Invalid response from server'
            };
        }

        const authResult = response.AuthenticationResult;
        
        return {
            success: true,
            accessToken: authResult.AccessToken,
            idToken: authResult.IdToken,
            refreshToken: authResult.RefreshToken,
            expiresIn: authResult.ExpiresIn
        };
    } catch (error) {
        console.error('Sign in error:', error);
        let errorMessage = error.message || 'Authentication failed';
        
        if (error.name === 'NotAuthorizedException') {
            errorMessage = 'Incorrect email or password';
        } else if (error.name === 'UserNotConfirmedException') {
            errorMessage = 'Please verify your email address before signing in';
        } else if (error.name === 'UserNotFoundException') {
            errorMessage = 'User not found. Please sign up first';
        } else if (error.name === 'InvalidParameterException') {
            errorMessage = 'Invalid parameters. Please check your credentials';
        }
        
        return {
            success: false,
            error: errorMessage
        };
    }
}

async function respondToNewPasswordChallenge(session, email, newPassword) {
    try {
        const challengeResponses = {
            USERNAME: email,
            NEW_PASSWORD: newPassword
        };

        const secretHash = computeSecretHash(email);
        if (secretHash) {
            challengeResponses.SECRET_HASH = secretHash;
        }

        const params = {
            ClientId: CLIENT_ID,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: session,
            ChallengeResponses: challengeResponses
        };

        const command = new RespondToAuthChallengeCommand(params);
        const response = await client.send(command);

        if (response.AuthenticationResult) {
            const authResult = response.AuthenticationResult;
            return {
                success: true,
                accessToken: authResult.AccessToken,
                idToken: authResult.IdToken,
                refreshToken: authResult.RefreshToken,
                expiresIn: authResult.ExpiresIn
            };
        } else {
            return {
                success: false,
                error: 'Failed to complete password change'
            };
        }
    } catch (error) {
        console.error('Respond to challenge error:', error);
        let errorMessage = error.message || 'Password change failed';
        
        if (error.name === 'InvalidPasswordException') {
            errorMessage = 'Password does not meet requirements';
        } else if (error.name === 'NotAuthorizedException') {
            errorMessage = 'Session expired. Please try logging in again';
        }
        
        return {
            success: false,
            error: errorMessage
        };
    }
}

async function getUser(accessToken) {
    try {
        const params = {
            AccessToken: accessToken
        };

        const command = new GetUserCommand(params);
        const response = await client.send(command);
        
        const userAttributes = {};
        response.UserAttributes.forEach(attr => {
            userAttributes[attr.Name] = attr.Value;
        });

        return {
            success: true,
            username: response.Username,
            attributes: userAttributes
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

async function signOut(accessToken) {
    try {
        const params = {
            AccessToken: accessToken
        };

        const command = new GlobalSignOutCommand(params);
        await client.send(command);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

async function verifyToken(accessToken) {
    if (!accessToken) {
        return { valid: false, error: 'No token provided' };
    }

    try {
        const userInfo = await getUser(accessToken);
        if (userInfo.success) {
            return { valid: true, user: userInfo };
        }
        return { valid: false, error: userInfo.error };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

module.exports = {
    signUp,
    confirmSignUp,
    signIn,
    respondToNewPasswordChallenge,
    getUser,
    signOut,
    verifyToken
};

