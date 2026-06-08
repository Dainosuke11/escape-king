import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playerRouter from "./player";
import friendsRouter from "./friends";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playerRouter);
router.use(friendsRouter);

export default router;
