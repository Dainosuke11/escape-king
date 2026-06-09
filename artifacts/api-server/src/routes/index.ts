import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playerRouter from "./player";
import friendsRouter from "./friends";
import kofiRouter from "./kofi";
import referralRouter from "./referral";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playerRouter);
router.use(friendsRouter);
router.use(kofiRouter);
router.use(referralRouter);

export default router;
